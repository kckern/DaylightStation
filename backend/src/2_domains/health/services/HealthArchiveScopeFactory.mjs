/**
 * HealthArchiveScopeFactory (F4-A)
 *
 * Builds per-user HealthArchiveScope instances. Different users can declare
 * different workout sources in their playbook (`archive.workout_sources`)
 * — Strava+Garmin for one user, Apple Health for another — so the scope
 * is no longer a single shared instance.
 *
 * The factory:
 *   - Holds the absolute `dataRoot` / `mediaRoot` and a `personalContextLoader`
 *   - Exposes `forUser(userId)` returning a HealthArchiveScope
 *   - Caches per-userId for `cacheTtlMs` (default 1h) so playbook edits
 *     eventually take effect without process restart
 *
 * The cache is small (one entry per active user). Cache misses log at debug;
 * cache hits log at debug too — both are useful when investigating "why is
 * my new workout source not allowed yet?"
 *
 * Backward compat: if a user has no `archive.workout_sources` block (or no
 * playbook at all), the factory returns a scope built from
 * `DEFAULT_WORKOUT_SOURCES` only (= `['strava', 'garmin']`).
 *
 * @module domains/health/services/HealthArchiveScopeFactory
 */

import {
  HealthArchiveScope,
  DEFAULT_WORKOUT_SOURCES,
} from './HealthArchiveScope.mjs';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class HealthArchiveScopeFactory {
  #dataRoot;
  #mediaRoot;
  #personalContextLoader;
  #logger;
  #cache;
  #cacheTtlMs;
  #now;

  /**
   * @param {object} opts
   * @param {string} opts.dataRoot Absolute path to the data root
   * @param {string} opts.mediaRoot Absolute path to the media root
   * @param {object} [opts.personalContextLoader] Loader exposing
   *   `loadPlaybook(userId)`. When absent, every user gets a default-only
   *   scope — used in tests and as a graceful-degradation path in prod.
   * @param {object} [opts.logger] Logger (default: console)
   * @param {number} [opts.cacheTtlMs] TTL for cached scopes (default 1h)
   * @param {() => number} [opts.now] Clock injection for tests; defaults to
   *   `Date.now`.
   */
  constructor({
    dataRoot,
    mediaRoot,
    personalContextLoader = null,
    logger = console,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    now = () => Date.now(),
  } = {}) {
    if (!dataRoot || typeof dataRoot !== 'string') {
      throw new Error('HealthArchiveScopeFactory: dataRoot is required');
    }
    if (!mediaRoot || typeof mediaRoot !== 'string') {
      throw new Error('HealthArchiveScopeFactory: mediaRoot is required');
    }
    this.#dataRoot = dataRoot;
    this.#mediaRoot = mediaRoot;
    this.#personalContextLoader = personalContextLoader;
    this.#logger = logger;
    this.#cacheTtlMs = cacheTtlMs;
    this.#now = now;
    this.#cache = new Map(); // userId -> { scope, expiresAt }
  }

  /**
   * Resolve a HealthArchiveScope for `userId`. Reads the user's playbook
   * (when a loader is wired), unions `archive.workout_sources` with the
   * built-in defaults, validates them, and constructs the scope.
   *
   * Cached for `cacheTtlMs` so subsequent calls within the TTL window are
   * cheap. Outside the window the entry is rebuilt from playbook on demand.
   *
   * @param {string} userId
   * @returns {Promise<HealthArchiveScope>}
   */
  async forUser(userId) {
    HealthArchiveScope.assertValidUserId(userId);

    const cached = this.#cache.get(userId);
    if (cached && cached.expiresAt > this.#now()) {
      this.#logger.debug?.('archive_scope_factory.cache_hit', { userId });
      return cached.scope;
    }

    this.#logger.debug?.('archive_scope_factory.cache_miss', { userId });

    const sources = await this.#resolveWorkoutSources(userId);
    const scope = new HealthArchiveScope({
      dataRoot: this.#dataRoot,
      mediaRoot: this.#mediaRoot,
      workoutSources: sources,
    });

    this.#cache.set(userId, {
      scope,
      expiresAt: this.#now() + this.#cacheTtlMs,
    });
    return scope;
  }

  /**
   * Drop a cached scope for `userId`. Useful when an out-of-band playbook
   * update happens and we want the next call to pick it up immediately.
   *
   * @param {string} userId
   */
  invalidate(userId) {
    this.#cache.delete(userId);
  }

  /**
   * Drop the entire cache. Mostly for tests.
   */
  invalidateAll() {
    this.#cache.clear();
  }

  /**
   * Read the user's playbook and merge default workout sources with any
   * declared in `archive.workout_sources`. Errors and missing config yield
   * defaults — the factory must not block on a bad playbook.
   *
   * @private
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async #resolveWorkoutSources(userId) {
    const defaults = [...DEFAULT_WORKOUT_SOURCES];
    if (!this.#personalContextLoader
        || typeof this.#personalContextLoader.loadPlaybook !== 'function') {
      return defaults;
    }

    let playbook = null;
    try {
      playbook = await this.#personalContextLoader.loadPlaybook(userId);
    } catch (err) {
      this.#logger.warn?.('archive_scope_factory.playbook_load_failed', {
        userId,
        error: err?.message || String(err),
      });
      return defaults;
    }

    const declared = playbook?.archive?.workout_sources;
    if (!Array.isArray(declared) || declared.length === 0) {
      return defaults;
    }

    // Union, preserving order: defaults first, then any extras the user
    // declared. Constructor de-duplicates and validates element shape.
    const union = [...defaults];
    for (const src of declared) {
      if (typeof src === 'string' && !union.includes(src)) {
        union.push(src);
      }
    }
    return union;
  }
}

export default HealthArchiveScopeFactory;
