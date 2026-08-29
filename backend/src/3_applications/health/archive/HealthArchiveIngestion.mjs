/**
 * HealthArchiveIngestion Service
 *
 * Pure-domain service that performs an incremental copy of whitelisted health
 * archive files from a source location into a per-user destination directory
 * (e.g. `data/users/{userId}/lifelog/archives/` for structured archives or
 * `media/archives/` for raw blobs).
 *
 * The service is filesystem-agnostic: it depends on an injected `fs` adapter
 * exposing `stat`, `readFile`, `writeFile`, `mkdir`, and `readdir`. This makes
 * the service trivially testable with an in-memory mock.
 *
 * Hard-fails on any source path that matches a privacy keyword pattern
 * (email, chat, finance, journal, search-history, calendar, social, banking).
 * NOTE: this is a coarse opaque-string filter on the raw `sourcePath`. It
 * over-rejects safely (e.g. `/email-not-really` is blocked) but does NOT
 * defend against `..` traversal or symlink escape — absolute-path
 * normalization and read-scope enforcement live in `HealthArchiveScope`
 * (Task 11 / F-106). Don't rely on this filter alone to bound mirror scope.
 *
 * @module domains/health/services
 */
import { BUILT_IN_CATEGORIES } from '#domains/health/entities/HealthArchiveManifest.mjs';
import {
  FLOOR_EXCLUSIONS,
  compileAdditions,
  matchesExclusion,
} from '#domains/health/policies/PrivacyExclusions.mjs';
import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { ConfigurationError } from '#apps/common/errors/SemanticErrors.mjs';

export class HealthArchiveIngestion {
  /**
   * @param {Object} deps
   * @param {Object} deps.fs - Injected filesystem adapter with the methods
   *   `stat`, `readFile`, `writeFile`, `mkdir`, `readdir` (all Promise-returning).
   * @param {Object} [deps.logger] - Optional logger; defaults to `console`.
   */
  constructor({ archiveMirror, logger } = {}) {
    if (!archiveMirror) throw new ConfigurationError('HealthArchiveIngestion requires archive mirror', { code: 'MISSING_FS_ADAPTER', key: 'archiveMirror' });
    this.archiveMirror = archiveMirror;
    this.logger = logger || console;
  }

  /**
   * Perform an incremental copy from `sourcePath` to `destPath`.
   *
   * @param {Object} opts
   * @param {string} opts.userId - Owning user identifier.
   * @param {string} opts.category - One of the whitelist categories.
   * @param {string} opts.sourcePath - Absolute source directory.
   * @param {string} opts.destPath - Absolute destination directory.
   * @param {boolean} [opts.dryRun=false] - If true, plan only — no writes.
   * @param {Iterable<string>} [opts.customCategories] - Per-user extra
   *   categories (from playbook `archive.custom_categories`). Merged with
   *   `BUILT_IN_CATEGORIES` to form the accepted set. Pre-F4-B callers can
   *   omit this and the floor is used.
   * @param {Iterable<string>} [opts.additionalPrivacyExclusions] - Per-user
   *   extra substring patterns to reject (from playbook
   *   `archive.additional_privacy_exclusions`). The code-level floor
   *   (email/chat/...) is ALWAYS applied; these only ADD. See
   *   `domains/health/policies/PrivacyExclusions.mjs`.
   * @returns {Promise<{copied: string[], skipped: string[], failed: Array<{file: string, error: string}>}>}
   */
  async ingest({
    userId,
    category,
    sourcePath,
    destPath,
    dryRun = false,
    customCategories,
    additionalPrivacyExclusions,
  }) {
    if (!userId) throw new ValidationError('HealthArchiveIngestion.ingest requires userId', { code: 'MISSING_USER_ID', field: 'userId' });
    const validCategories = new Set([
      ...BUILT_IN_CATEGORIES,
      ...(customCategories ? Array.from(customCategories) : []),
    ]);
    if (!validCategories.has(category)) {
      throw new ValidationError(`Unknown category: ${category}`, { code: 'UNKNOWN_CATEGORY', field: 'category', value: category });
    }
    const compiledAdditions = compileAdditions(additionalPrivacyExclusions);
    if (matchesExclusion(sourcePath, compiledAdditions)) {
      // Distinguish floor matches from user-addition matches in the log so
      // operators can tell whether a path was rejected by the immutable code
      // floor or by the user's own playbook list.
      const floorMatched = FLOOR_EXCLUSIONS.some((p) => p.test(sourcePath));
      if (!floorMatched && compiledAdditions.length > 0) {
        this.logger.info?.('privacy.addition_matched', { userId, category, sourcePath });
      }
      this.logger.warn?.('ingest.exclusion_rejected', { userId, category, sourcePath });
      throw new DomainInvariantError(`Source path matches exclusion pattern: ${sourcePath}`, { code: 'EXCLUSION_PATTERN_MATCHED', details: { sourcePath } });
    }
    if (customCategories
        && Array.from(customCategories).includes(category)
        && !BUILT_IN_CATEGORIES.includes(category)) {
      this.logger.info?.('ingest.custom_category_used', { userId, category });
    }

    this.logger.info?.('ingest.start', { userId, category, sourcePath, destPath, dryRun });

    const report = { copied: [], skipped: [], failed: [] };
    const files = await this.archiveMirror.listFiles(sourcePath);

    for (const file of files) {
      try {
        const needsCopy = await this.archiveMirror.needsCopy({ sourceRoot: sourcePath, destinationRoot: destPath, relativeName: file });
        if (!needsCopy) {
          report.skipped.push(file);
          continue;
        }
        if (!dryRun) {
          await this.archiveMirror.copy({ sourceRoot: sourcePath, destinationRoot: destPath, relativeName: file });
        }
        report.copied.push(file);
      } catch (err) {
        this.logger.warn?.('ingest.file_failed', { userId, category, file, error: err.message });
        report.failed.push({ file, error: err.message });
      }
    }

    this.logger.info?.('ingest.complete', {
      userId,
      category,
      copied: report.copied.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
    });

    return report;
  }

}

export default HealthArchiveIngestion;
