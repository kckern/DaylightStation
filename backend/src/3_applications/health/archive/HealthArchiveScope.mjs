/**
 * HealthArchiveScope (F-106)
 *
 * Hard-coded read whitelist for the health-archive longitudinal-access
 * surface. Every longitudinal tool (query_historical_weight, ...nutrition,
 * ...workouts, query_named_period, read_notes_file, find_similar_period)
 * must call `archiveScope.assertReadable(absPath, userId)` BEFORE any
 * filesystem touch.
 *
 * The semantic whitelist covers a user's weight history, configured workout
 * sources, nutrition history, scans, notes, playbook, and health profile, plus
 * shared workout archives. The filesystem adapter owns the concrete directory
 * layout and root containment rules for those categories.
 *
 * F4-A: workout-source vocabulary used to live in code as the literal path
 * segments `strava` and `garmin`. It now flows through the constructor as
 * `workoutSources: string[]` (default = `DEFAULT_WORKOUT_SOURCES`). Per-user
 * scopes are constructed via `HealthArchiveScopeFactory` which merges the
 * defaults with the user's `archive.workout_sources` from playbook.
 *
 * API shape:
 *   - `assertValidUserId` and `validatePathSegment` are pure regex/string
 *     checks and remain static — no roots required.
 *   - `isReadable` and `assertReadable` are instance methods because the
 *     whitelist must be anchored at known absolute prefixes and a known
 *     workout-source vocabulary. Concrete archive addressing is supplied by
 *     the composition root via `archiveAddressPolicy`.
 *     Bootstrap instantiates a per-user instance via
 *     `HealthArchiveScopeFactory.forUser(userId)` and injects the factory
 *     downstream as `archiveScopeFactory`.
 *
 * Defenses:
 *   - userId format validated (`/^[a-zA-Z0-9_-]+$/`) before any matching
 *   - Input rejected if it contains a NUL byte before normalization
 *   - Input locations are normalized by the archive-addressing adapter to
 *     collapse `..` segments
 *   - Path must be absolute — relative paths refused outright
 *   - Whitelist match REQUIRES `absPath` to start with the configured
 *     `dataRoot` or `mediaRoot`. A leading prefix anywhere in the path is
 *     no longer sufficient — defenses against user-supplied paths in
 *     downstream tools (e.g. read_notes_file).
 *   - Privacy exclusion patterns (email/chat/finance/journal/search-history/
 *     calendar/social/banking) reject otherwise-whitelisted paths
 *   - Workout-source segments (the dynamic part of the whitelist) are
 *     validated against `/^[a-zA-Z0-9_-]+$/` at construction so a hostile
 *     playbook can't smuggle regex metacharacters or path separators into
 *     the whitelist.
 *
 * NOT covered (intentional, documented):
 *   - Symlink-based escape: this service is path-string only and does not
 *     stat the filesystem. Defense-in-depth concern; live integration test
 *     under tests/live/ is the planned follow-up. Long-term option: have
 *     callers `fs.realpath` the path and re-check against the scope.
 *   - TOCTOU (time-of-check-to-time-of-use) races: same caveat as above —
 *     the check is on the path string callers pass in, not the file they
 *     actually open. Callers should pass the same path they intend to read.
 *
 * @module apps/health/archive/HealthArchiveScope
 */
import {
  compileAdditions,
  matchesExclusion,
} from '#domains/health/policies/PrivacyExclusions.mjs';
import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { assertValidHealthUserId } from '#domains/health/policies/HealthUserId.mjs';

// Workout-source segments must look like a path-safe identifier — no slashes,
// no regex metacharacters, no traversal sequences.
const WORKOUT_SOURCE_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * The two workout sources the codebase has historical knowledge of. Acts as
 * the floor — every user gets these even without playbook config. Adding a
 * source here is a code change with cross-cutting test impact; users add
 * sources per-playbook via `archive.workout_sources` instead.
 */
export const DEFAULT_WORKOUT_SOURCES = Object.freeze(['strava', 'garmin']);

/**
 * Validate and de-duplicate a workout-sources list. Throws on any element
 * that doesn't look like a path-safe identifier. Returns a frozen array.
 *
 * @param {string[]} sources
 * @returns {ReadonlyArray<string>}
 */
function normalizeWorkoutSources(sources) {
  if (!Array.isArray(sources)) {
    throw new ValidationError(
      `HealthArchiveScope: workoutSources must be an array (got: ${String(sources)})`,
      { code: 'INVALID_WORKOUT_SOURCES', field: 'workoutSources', value: sources },
    );
  }
  const seen = new Set();
  const out = [];
  for (const raw of sources) {
    if (typeof raw !== 'string' || !WORKOUT_SOURCE_PATTERN.test(raw)) {
      throw new ValidationError(
        `HealthArchiveScope: invalid workoutSource "${String(raw)}" — must match ${WORKOUT_SOURCE_PATTERN}`,
        { code: 'INVALID_WORKOUT_SOURCE', field: 'workoutSource', value: raw },
      );
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return Object.freeze(out);
}

export class HealthArchiveScope {
  #archiveAddressPolicy;
  #workoutSources;
  #additionalPrivacyExclusions;
  #compiledAdditions;

  /**
   * @param {object} opts
   * @param {object} opts.archiveAddressPolicy Root-bound archive addressing
   *   capability supplied by an adapter.
   * @param {string[]} [opts.workoutSources] Workout-source path segments to
   *   include in the whitelist. Defaults to `DEFAULT_WORKOUT_SOURCES`. The
   *   factory (`HealthArchiveScopeFactory`) merges these with the user's
   *   `archive.workout_sources` playbook entry.
   * @param {string[]} [opts.additionalPrivacyExclusions] Per-user extra
   *   substring patterns to reject (from playbook
   *   `archive.additional_privacy_exclusions`). The floor (email/chat/...) is
   *   ALWAYS applied; these only ADD. Strings are escaped before regex
   *   compilation, matched case-insensitively. See
   *   `domains/health/policies/PrivacyExclusions.mjs` for floor + semantics.
   */
  constructor({ archiveAddressPolicy, workoutSources, additionalPrivacyExclusions } = {}) {
    if (!archiveAddressPolicy?.isReadableLocation) {
      throw new ValidationError(
        'HealthArchiveScope: archiveAddressPolicy is required',
        { code: 'MISSING_ARCHIVE_ADDRESS_POLICY', field: 'archiveAddressPolicy', value: archiveAddressPolicy },
      );
    }
    this.#archiveAddressPolicy = archiveAddressPolicy;
    this.#workoutSources = normalizeWorkoutSources(
      workoutSources === undefined ? [...DEFAULT_WORKOUT_SOURCES] : workoutSources,
    );
    // Capture the raw additions for introspection (e.g. tests, logs) and
    // compile them once for fast-path matching in isReadable.
    this.#additionalPrivacyExclusions = Object.freeze(
      Array.isArray(additionalPrivacyExclusions)
        ? additionalPrivacyExclusions.filter((s) => typeof s === 'string' && s.trim().length > 0)
        : [],
    );
    this.#compiledAdditions = compileAdditions(this.#additionalPrivacyExclusions);
  }

  /** @returns {ReadonlyArray<string>} workout-source path segments in scope */
  get workoutSources() { return this.#workoutSources; }

  /**
   * @returns {ReadonlyArray<string>} the user-supplied additional
   *   privacy-exclusion substrings (post-trim, post-filter). The code-level
   *   floor is NOT included here — see `policies/PrivacyExclusions.mjs`.
   */
  get additionalPrivacyExclusions() { return this.#additionalPrivacyExclusions; }

  /**
   * Validate userId format. Throws on invalid input. Use this at every tool
   * entry point — userIds flow through every longitudinal tool unmodified
   * and a malformed one is a programmer/security error worth surfacing.
   *
   * Pure function. No instance state required.
   *
   * @param {unknown} userId
   * @throws {Error} when userId is not a non-empty string matching
   *   /^[a-zA-Z0-9_-]+$/
   */
  static assertValidUserId(userId) {
    assertValidHealthUserId(userId);
  }

  /**
   * Validate a path segment intended for interpolation into a whitelisted
   * path (e.g. the `filename` argument of read_notes_file). Permits letters,
   * digits, underscore, hyphen, dot, and slash. Relative components are
   * collapsed first so any surviving `..` traversal is rejected.
   *
   * Pure function. No instance state required.
   *
   * @param {string} segment
   * @returns {string} the normalized segment (suitable to join into a path)
   * @throws {Error} when the segment is empty, contains a traversal
   *   sequence, contains a NUL byte, or contains characters outside the
   *   safe set
   */
  static validatePathSegment(segment) {
    if (!segment || typeof segment !== 'string') {
      throw new ValidationError('HealthArchiveScope: path segment must be a non-empty string', { code: 'INVALID_PATH_SEGMENT', field: 'segment', value: segment });
    }
    // NUL check BEFORE normalize — Node preserves NULs through normalize
    // today, but don't depend on that across versions.
    if (segment.includes('\0')) {
      throw new ValidationError(`HealthArchiveScope: unsafe path segment (NUL byte): ${JSON.stringify(segment)}`, { code: 'UNSAFE_PATH_SEGMENT_NUL', field: 'segment', value: segment });
    }
    const normalized = normalizeRelativeSegment(segment);
    // After normalization, any traversal yields a leading '..' or absolute
    // path. Reject both. Also reject anything outside the safe character
    // set (letters, digits, dot, underscore, hyphen, forward slash).
    if (
      segment.startsWith('/') ||
      normalized.startsWith('..') ||
      normalized.startsWith('/') ||
      !/^[a-zA-Z0-9._/-]+$/.test(normalized)
    ) {
      throw new ValidationError(`HealthArchiveScope: unsafe path segment: ${segment}`, { code: 'UNSAFE_PATH_SEGMENT', field: 'segment', value: segment });
    }
    return normalized;
  }

  /**
   * Returns true iff the absolute path is readable by `userId` under the
   * F-106 whitelist, anchored at the configured `dataRoot` / `mediaRoot`.
   * Pure(-ish) — uses only this instance's roots, does not touch the
   * filesystem.
   *
   * Returns false (NOT throws) on invalid userId / non-string / non-absolute
   * / empty path inputs, so callers can use this as a soft gate (e.g. for
   * logging) without needing a try/catch. Use `assertReadable` when a
   * violation is a hard error.
   *
   * @param {unknown} absPath
   * @param {unknown} userId
   * @returns {boolean}
   */
  isReadable(absPath, userId) {
    // Soft validation — invalid input returns false rather than throwing.
    if (!absPath || typeof absPath !== 'string') return false;
    if (!userId || typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
      return false;
    }

    return this.#archiveAddressPolicy.isReadableLocation({
      location: absPath,
      userId,
      workoutSources: this.#workoutSources,
      isPrivacyExcluded: normalized => matchesExclusion(normalized, this.#compiledAdditions),
    });
  }

  /**
   * Hard-assert that the path is readable for `userId`. Throws on any
   * violation — including malformed userId. Wrap every longitudinal-tool
   * read with this.
   *
   * @param {string} absPath
   * @param {string} userId
   * @returns {void}
   * @throws {Error} when not readable
   */
  assertReadable(absPath, userId) {
    // Hard-validate userId first so a malformed one surfaces with a precise
    // message rather than a generic "not readable" failure.
    HealthArchiveScope.assertValidUserId(userId);

    if (!this.isReadable(absPath, userId)) {
      throw new DomainInvariantError(
        `HealthArchiveScope: path not readable for user ${userId}: ${String(absPath)}`,
        { code: 'PATH_NOT_READABLE' },
      );
    }
  }

}

function normalizeRelativeSegment(segment) {
  const parts = [];
  for (const part of segment.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else parts.push(part);
    } else {
      parts.push(part);
    }
  }
  const normalized = parts.join('/') || '.';
  return segment.endsWith('/') && normalized !== '.' ? `${normalized}/` : normalized;
}

export default HealthArchiveScope;
