/**
 * HealthArchiveScope (F-106)
 *
 * Hard-coded read whitelist for the health-archive longitudinal-access
 * surface. Every longitudinal tool (query_historical_weight, ...nutrition,
 * ...workouts, query_named_period, read_notes_file, find_similar_period)
 * must call `HealthArchiveScope.assertReadable(absPath, userId)` BEFORE any
 * filesystem touch.
 *
 * Whitelist (verbatim from PRD F-106):
 *   - data/users/{userId}/lifelog/archives/weight.yaml
 *   - data/users/{userId}/lifelog/archives/strava/**
 *   - data/users/{userId}/lifelog/archives/garmin/**
 *   - data/users/{userId}/lifelog/archives/nutrition-history/**
 *   - data/users/{userId}/lifelog/archives/scans/**
 *   - data/users/{userId}/lifelog/archives/notes/**
 *   - data/users/{userId}/lifelog/archives/playbook/**
 *   - data/users/{userId}/health.yml
 *   - media/archives/strava/**       (cross-user, no userId scope)
 *
 * Defenses:
 *   - userId format validated (`/^[a-zA-Z0-9_-]+$/`) before any matching
 *   - Input path normalized via `path.normalize` to collapse `..` segments
 *   - Path must be absolute — relative paths refused outright
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
 * Pure functions, no instance state, no I/O. Safe to call from any layer.
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

// Cross-user shared archive (only entry that does NOT bind to a userId).
const SHARED_STRAVA_TAIL = /(?:^|\/)media\/archives\/strava\/.+/;

/**
 * Build the per-user whitelist of tail patterns. Each pattern matches the
 * *normalized* absolute path's tail (everything from the first whitelisted
 * segment onward), so the absolute prefix doesn't matter.
 *
 * @param {string} userId
 * @returns {RegExp[]}
 */
function buildUserWhitelist(userId) {
  // Escape regex metachars in the userId — defense in depth even though the
  // userId pattern already restricts to [A-Za-z0-9_-].
  const u = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const userBase = `data/users/${u}/lifelog/archives`;
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
    new RegExp(`(?:^|\\/)data\\/users\\/${u}\\/health\\.yml$`),
  ];
}

export class HealthArchiveScope {
  /**
   * Validate userId format. Throws on invalid input. Use this at every tool
   * entry point — userIds flow through every longitudinal tool unmodified
   * and a malformed one is a programmer/security error worth surfacing.
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
   * @param {string} segment
   * @returns {string} the normalized segment (suitable to join into a path)
   * @throws {Error} when the segment is empty, contains a traversal
   *   sequence, or contains characters outside the safe set
   */
  static validatePathSegment(segment) {
    if (!segment || typeof segment !== 'string') {
      throw new Error('HealthArchiveScope: path segment must be a non-empty string');
    }
    const normalized = path.normalize(segment);
    // After normalization, any traversal yields a leading '..' or absolute
    // path. Reject both.
    if (
      normalized.startsWith('..') ||
      normalized.startsWith('/') ||
      normalized.includes('\0') ||
      !/^[a-zA-Z0-9._/-]+$/.test(normalized)
    ) {
      throw new Error(`HealthArchiveScope: unsafe path segment: ${segment}`);
    }
    return normalized;
  }

  /**
   * Returns true iff the absolute path is readable by `userId` under the
   * F-106 whitelist. Pure function — does not throw on out-of-scope paths,
   * does not touch the filesystem.
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
  static isReadable(absPath, userId) {
    // Soft validation — invalid input returns false rather than throwing.
    if (!absPath || typeof absPath !== 'string') return false;
    if (!userId || typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
      return false;
    }

    // Must be absolute — relative paths and bare names are refused.
    if (!path.isAbsolute(absPath)) return false;

    // Normalize first so `..` segments collapse before whitelist matching.
    const normalized = path.normalize(absPath);

    // Whitespace, NUL, or other suspicious characters — reject.
    if (normalized.includes('\0')) return false;

    // Privacy exclusion is checked AGAINST the normalized path. Anything
    // matching email/chat/finance/journal/search-history/calendar/social/
    // banking is rejected even if the rest of the path is whitelisted.
    if (PRIVACY_EXCLUSIONS.some((re) => re.test(normalized))) return false;

    // Cross-user shared archive: media/archives/strava/**.
    if (SHARED_STRAVA_TAIL.test(normalized)) return true;

    // Per-user whitelist: data/users/{userId}/...
    const userWhitelist = buildUserWhitelist(userId);
    return userWhitelist.some((re) => re.test(normalized));
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
  static assertReadable(absPath, userId) {
    // Hard-validate userId first so a malformed one surfaces with a precise
    // message rather than a generic "not readable" failure.
    HealthArchiveScope.assertValidUserId(userId);

    if (!HealthArchiveScope.isReadable(absPath, userId)) {
      throw new Error(
        `HealthArchiveScope: path not readable for user ${userId}: ${String(absPath)}`,
      );
    }
  }
}

export default HealthArchiveScope;
