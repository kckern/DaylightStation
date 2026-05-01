/**
 * HealthArchiveScope (F-106)
 *
 * Hard-coded read whitelist for the health-archive longitudinal-access
 * surface. Every longitudinal tool (query_historical_weight, ...nutrition,
 * ...workouts, query_named_period, read_notes_file, find_similar_period)
 * must call `archiveScope.assertReadable(absPath, userId)` BEFORE any
 * filesystem touch.
 *
 * Whitelist (verbatim from PRD F-106), anchored at the configured
 * `dataRoot` / `mediaRoot` (both absolute):
 *   - {dataRoot}/users/{userId}/lifelog/archives/weight.yaml
 *   - {dataRoot}/users/{userId}/lifelog/archives/strava/**
 *   - {dataRoot}/users/{userId}/lifelog/archives/garmin/**
 *   - {dataRoot}/users/{userId}/lifelog/archives/nutrition-history/**
 *   - {dataRoot}/users/{userId}/lifelog/archives/scans/**
 *   - {dataRoot}/users/{userId}/lifelog/archives/notes/**
 *   - {dataRoot}/users/{userId}/lifelog/archives/playbook/**
 *   - {dataRoot}/users/{userId}/health.yml
 *   - {mediaRoot}/archives/strava/**       (cross-user, no userId scope)
 *
 * API shape:
 *   - `assertValidUserId` and `validatePathSegment` are pure regex/string
 *     checks and remain static — no roots required.
 *   - `isReadable` and `assertReadable` are instance methods because the
 *     whitelist must be anchored at a known absolute prefix. Construct via
 *     `new HealthArchiveScope({ dataRoot, mediaRoot })`. Bootstrap
 *     instantiates this once and injects it as a dependency (`archiveScope`).
 *
 * Defenses:
 *   - userId format validated (`/^[a-zA-Z0-9_-]+$/`) before any matching
 *   - Input rejected if it contains a NUL byte (checked BEFORE
 *     `path.normalize` to avoid relying on Node preserving NULs through
 *     normalization across versions)
 *   - Input path normalized via `path.normalize` to collapse `..` segments
 *   - Path must be absolute — relative paths refused outright
 *   - Whitelist match REQUIRES `absPath` to start with the configured
 *     `dataRoot` or `mediaRoot`. A leading prefix anywhere in the path is
 *     no longer sufficient — defenses against user-supplied paths in
 *     downstream tools (e.g. read_notes_file).
 *   - Privacy exclusion patterns (email/chat/finance/journal/search-history/
 *     calendar/social/banking) reject otherwise-whitelisted paths
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
 * @module domains/health/services/HealthArchiveScope
 */
import path from 'node:path';

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Mirrors HealthArchiveIngestion.EXCLUSION_PATTERNS — defense in depth across
// both the write surface (ingestion) and the read surface (longitudinal
// tools). If you change one, change the other.
const PRIVACY_EXCLUSIONS = [
  /email/i,
  /chat/i,
  /finance/i,
  /journal\b/i,
  /search-history/i,
  /calendar/i,
  /social/i,
  /\bbanking\b/i,
];

/**
 * Build the per-user whitelist of tail patterns. Each pattern matches the
 * tail of the normalized absolute path (everything from `users/{id}/...`
 * onward). The caller is responsible for verifying the path STARTS with
 * the configured dataRoot prefix; these regexes only check the suffix.
 *
 * @param {string} userId
 * @returns {RegExp[]}
 */
function buildUserWhitelistTails(userId) {
  // Escape regex metachars in the userId — defense in depth even though the
  // userId pattern already restricts to [A-Za-z0-9_-].
  const u = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const userBase = `users/${u}/lifelog/archives`;
  return [
    // Single-file: weight.yaml
    new RegExp(`(?:^|\\/)${userBase}\\/weight\\.yaml$`),
    // Directory globs (everything beneath the named subdir)
    new RegExp(`(?:^|\\/)${userBase}\\/strava\\/.+`),
    new RegExp(`(?:^|\\/)${userBase}\\/garmin\\/.+`),
    new RegExp(`(?:^|\\/)${userBase}\\/nutrition-history\\/.+`),
    new RegExp(`(?:^|\\/)${userBase}\\/scans\\/.+`),
    new RegExp(`(?:^|\\/)${userBase}\\/notes\\/.+`),
    new RegExp(`(?:^|\\/)${userBase}\\/playbook\\/.+`),
    // Single-file: health.yml (one level above lifelog/)
    new RegExp(`(?:^|\\/)users\\/${u}\\/health\\.yml$`),
  ];
}

// Cross-user shared archive tail (only entry that does NOT bind to a userId).
const SHARED_STRAVA_TAIL = /(?:^|\/)archives\/strava\/.+/;

export class HealthArchiveScope {
  #dataRoot;
  #mediaRoot;

  /**
   * @param {object} opts
   * @param {string} opts.dataRoot Absolute path to the data root (the parent
   *   of `users/`). Required. e.g. `/srv/daylight/data`
   * @param {string} opts.mediaRoot Absolute path to the media root (the
   *   parent of `archives/`). Required. e.g. `/srv/daylight/media`
   */
  constructor({ dataRoot, mediaRoot } = {}) {
    if (!dataRoot || typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
      throw new Error(
        `HealthArchiveScope: dataRoot must be an absolute path string (got: ${String(dataRoot)})`,
      );
    }
    if (!mediaRoot || typeof mediaRoot !== 'string' || !path.isAbsolute(mediaRoot)) {
      throw new Error(
        `HealthArchiveScope: mediaRoot must be an absolute path string (got: ${String(mediaRoot)})`,
      );
    }
    this.#dataRoot = path.normalize(dataRoot);
    this.#mediaRoot = path.normalize(mediaRoot);
  }

  /** @returns {string} configured absolute dataRoot (normalized) */
  get dataRoot() { return this.#dataRoot; }

  /** @returns {string} configured absolute mediaRoot (normalized) */
  get mediaRoot() { return this.#mediaRoot; }

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
    if (!userId || typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
      throw new Error(
        `HealthArchiveScope: invalid userId — must match ${USER_ID_PATTERN}: ${String(userId)}`,
      );
    }
  }

  /**
   * Validate a path segment intended for interpolation into a whitelisted
   * path (e.g. the `filename` argument of read_notes_file). Permits letters,
   * digits, underscore, hyphen, dot, and slash — but `path.normalize` is
   * applied first so any `..` traversal collapses to a leading `..` (which
   * the regex then rejects).
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
      throw new Error('HealthArchiveScope: path segment must be a non-empty string');
    }
    // NUL check BEFORE normalize — Node preserves NULs through normalize
    // today, but don't depend on that across versions.
    if (segment.includes('\0')) {
      throw new Error(`HealthArchiveScope: unsafe path segment (NUL byte): ${JSON.stringify(segment)}`);
    }
    const normalized = path.normalize(segment);
    // After normalization, any traversal yields a leading '..' or absolute
    // path. Reject both. Also reject anything outside the safe character
    // set (letters, digits, dot, underscore, hyphen, forward slash).
    if (
      normalized.startsWith('..') ||
      normalized.startsWith('/') ||
      !/^[a-zA-Z0-9._/-]+$/.test(normalized)
    ) {
      throw new Error(`HealthArchiveScope: unsafe path segment: ${segment}`);
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

    // NUL byte rejection BEFORE normalization. Node's path.normalize
    // currently preserves NULs, but the ordering invariant matters for
    // future Node versions — reject up front so the rest of the pipeline
    // never has to consider NUL-bearing input.
    if (absPath.includes('\0')) return false;

    // Must be absolute — relative paths and bare names are refused.
    if (!path.isAbsolute(absPath)) return false;

    // Normalize so `..` segments collapse before whitelist matching.
    const normalized = path.normalize(absPath);

    // Privacy exclusion is checked AGAINST the normalized path. Anything
    // matching email/chat/finance/journal/search-history/calendar/social/
    // banking is rejected even if the rest of the path is whitelisted.
    if (PRIVACY_EXCLUSIONS.some((re) => re.test(normalized))) return false;

    // Cross-user shared archive: must live under the configured mediaRoot
    // AND match the strava archive tail.
    if (this.#startsWithRoot(normalized, this.#mediaRoot)
        && SHARED_STRAVA_TAIL.test(normalized)) {
      return true;
    }

    // Per-user whitelist: must live under the configured dataRoot AND match
    // a per-user tail pattern.
    if (!this.#startsWithRoot(normalized, this.#dataRoot)) return false;

    const userTails = buildUserWhitelistTails(userId);
    return userTails.some((re) => re.test(normalized));
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
      throw new Error(
        `HealthArchiveScope: path not readable for user ${userId}: ${String(absPath)}`,
      );
    }
  }

  /**
   * Returns true iff `absPath` starts with `root`, with the boundary aligned
   * on a path separator. Guards against false positives like
   * `/srv/daylight-evil/...` matching `root=/srv/daylight`.
   *
   * @param {string} absPath
   * @param {string} root
   * @returns {boolean}
   */
  #startsWithRoot(absPath, root) {
    if (!absPath.startsWith(root)) return false;
    // Either exact match or next char is a path separator.
    if (absPath.length === root.length) return true;
    return absPath[root.length] === '/' || absPath[root.length] === path.sep;
  }
}

export default HealthArchiveScope;
