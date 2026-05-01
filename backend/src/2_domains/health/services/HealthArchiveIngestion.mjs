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
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILT_IN_CATEGORIES } from '../entities/HealthArchiveManifest.mjs';
import {
  FLOOR_EXCLUSIONS,
  compileAdditions,
  matchesExclusion,
} from '../policies/PrivacyExclusions.mjs';

export class HealthArchiveIngestion {
  /**
   * @param {Object} deps
   * @param {Object} deps.fs - Injected filesystem adapter with the methods
   *   `stat`, `readFile`, `writeFile`, `mkdir`, `readdir` (all Promise-returning).
   * @param {Object} [deps.logger] - Optional logger; defaults to `console`.
   */
  constructor({ fs, logger } = {}) {
    if (!fs) throw new Error('HealthArchiveIngestion requires fs adapter');
    this.fs = fs;
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
    if (!userId) throw new Error('HealthArchiveIngestion.ingest requires userId');
    const validCategories = new Set([
      ...BUILT_IN_CATEGORIES,
      ...(customCategories ? Array.from(customCategories) : []),
    ]);
    if (!validCategories.has(category)) {
      throw new Error(`Unknown category: ${category}`);
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
      throw new Error(`Source path matches exclusion pattern: ${sourcePath}`);
    }
    if (customCategories
        && Array.from(customCategories).includes(category)
        && !BUILT_IN_CATEGORIES.includes(category)) {
      this.logger.info?.('ingest.custom_category_used', { userId, category });
    }

    this.logger.info?.('ingest.start', { userId, category, sourcePath, destPath, dryRun });

    const report = { copied: [], skipped: [], failed: [] };
    const files = await this._listFiles(sourcePath);

    for (const file of files) {
      try {
        const action = await this._planFile({ file, sourcePath, destPath });
        if (action === 'skip') {
          report.skipped.push(file);
          continue;
        }
        if (!dryRun) {
          await this._copyFile({ file, sourcePath, destPath });
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

  /**
   * Recursively list every file beneath `root`, returning paths relative to it.
   * @private
   */
  async _listFiles(root) {
    const out = [];
    const walk = async (dir, rel) => {
      const entries = await this.fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const relPath = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          await walk(abs, relPath);
        } else if (entry.isFile()) {
          out.push(relPath);
        }
      }
    };
    await walk(root, '');
    return out;
  }

  /**
   * Decide whether a file should be skipped (already up-to-date) or copied.
   * Skip iff destination exists, dest mtime >= source mtime, AND content
   * hashes match. Anything else (including missing dest) yields 'copy'.
   * @private
   */
  async _planFile({ file, sourcePath, destPath }) {
    const srcAbs = path.join(sourcePath, file);
    const destAbs = path.join(destPath, file);

    const srcStat = await this.fs.stat(srcAbs);
    let destStat = null;
    try {
      destStat = await this.fs.stat(destAbs);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return 'copy';
      }
      throw err;
    }

    const srcMs = srcStat.mtimeMs ?? (srcStat.mtime ? srcStat.mtime.getTime() : 0);
    const destMs = destStat.mtimeMs ?? (destStat.mtime ? destStat.mtime.getTime() : 0);
    if (destMs < srcMs) return 'copy';

    const [srcBuf, destBuf] = await Promise.all([
      this.fs.readFile(srcAbs),
      this.fs.readFile(destAbs),
    ]);
    if (this._hash(srcBuf) === this._hash(destBuf)) return 'skip';
    return 'copy';
  }

  /**
   * Byte-for-byte copy with recursive parent-directory creation.
   * @private
   */
  async _copyFile({ file, sourcePath, destPath }) {
    const srcAbs = path.join(sourcePath, file);
    const destAbs = path.join(destPath, file);
    const buf = await this.fs.readFile(srcAbs);
    await this.fs.mkdir(path.dirname(destAbs), { recursive: true });
    await this.fs.writeFile(destAbs, buf);
  }

  /** @private */
  _hash(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
}

export default HealthArchiveIngestion;
