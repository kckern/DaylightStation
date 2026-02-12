/**
 * ProgressSyncService — Application-layer sync orchestration
 *
 * Orchestrates bidirectional progress sync between DS media_memory
 * and a remote media server. Manages:
 *   - debounceMap: pending remote writes (30s debounce)
 *   - skepticalMap: jump tracking (large-jump skepticism)
 */

import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { resolveProgressConflict } from '#domains/content/services/resolveProgressConflict.mjs';
import { isProgressCommittable } from '#domains/content/services/isProgressCommittable.mjs';

const DEBOUNCE_MS = 30_000; // 30 seconds
const LARGE_JUMP_THRESHOLD = 300; // 5 minutes in seconds

export class ProgressSyncService {
  /**
   * @param {Object} deps
   * @param {import('#apps/content/ports/IRemoteProgressProvider.mjs').IRemoteProgressProvider} deps.remoteProgressProvider
   * @param {import('#apps/content/ports/IMediaProgressMemory.mjs').IMediaProgressMemory} deps.mediaProgressMemory
   * @param {Object} [deps.logger]            - Logger (defaults to console)
   */
  constructor(deps) {
    this.#remoteProgressProvider = deps.remoteProgressProvider;
    this.#mediaProgressMemory = deps.mediaProgressMemory;
    this.#logger = deps.logger || console;

    /** @type {Map<string, { timer: any, localId: string, latestProgress: Object }>} */
    this._debounceMap = new Map();

    /** @type {Map<string, { lastCommittedPlayhead: number, watchTimeAccumulated: number, skepticalTarget: number|null, storagePath: string }>} */
    this._skepticalMap = new Map();
  }

  /** @type {import('#apps/content/ports/IRemoteProgressProvider.mjs').IRemoteProgressProvider} */ #remoteProgressProvider;
  /** @type {Object} */ #mediaProgressMemory;
  /** @type {Object} */ #logger;

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Called on play start for remote-synced items. Read path.
   *
   * 1. Parallel fetch: local + remote (catch errors -> null)
   * 2. If local exists with playhead > 0: save session-start bookmark
   * 3. Run resolveProgressConflict(local, remote)
   * 4. If resolution is null: return local or null
   * 5. Initialize skepticalMap entry
   * 6. If remote won: update DS media_memory, return updated
   * 7. If local won: buffer debounced remote write-back, return local
   *
   * @param {string} itemId
   * @param {string} storagePath
   * @param {string} localId - Remote server-native item ID
   * @returns {Promise<MediaProgress|null>}
   */
  async reconcileOnPlay(itemId, storagePath, localId) {
    // 1. Parallel fetch
    const [local, remote] = await Promise.all([
      this.#mediaProgressMemory.get(itemId, storagePath),
      this.#fetchRemoteProgress(localId),
    ]);

    // 2. Session-start bookmark
    if (local && local.playhead > 0) {
      const bookmarked = new MediaProgress({
        itemId: local.itemId,
        playhead: local.playhead,
        duration: local.duration,
        playCount: local.playCount,
        lastPlayed: local.lastPlayed,
        watchTime: local.watchTime,
        bookmark: {
          playhead: local.playhead,
          reason: 'session-start',
          createdAt: new Date().toISOString(),
        },
      });
      await this.#mediaProgressMemory.set(bookmarked, storagePath);
    }

    // 3. Resolve conflict
    const resolution = resolveProgressConflict(
      local ? { playhead: local.playhead, duration: local.duration, isWatched: local.isWatched(), lastPlayed: local.lastPlayed, watchTime: local.watchTime } : null,
      remote,
    );

    // 4. Null resolution
    if (!resolution) {
      return local || null;
    }

    // 5. Initialize skeptical tracking (including storagePath)
    this._skepticalMap.set(itemId, {
      lastCommittedPlayhead: resolution.playhead,
      watchTimeAccumulated: 0,
      storagePath,
    });

    // 6. Remote won — update local store
    if (resolution.source === 'remote') {
      const updated = new MediaProgress({
        itemId,
        playhead: resolution.playhead,
        duration: resolution.duration,
        lastPlayed: new Date().toISOString(),
        watchTime: local?.watchTime ?? 0,
      });
      await this.#mediaProgressMemory.set(updated, storagePath);
      return updated;
    }

    // 7. Local won — buffer remote write-back
    if (local) {
      this.#bufferRemoteWrite(itemId, localId, {
        currentTime: local.playhead,
        isFinished: local.percent >= 90,
      });
      return local;
    }

    return null;
  }

  /**
   * Called on each progress update for remote-synced items. Write path.
   *
   * 1. Get or create skepticalMap tracking entry
   * 2. Calculate jumpDistance from lastCommittedPlayhead
   * 3. Large jump (> 300s) with existing progress: save pre-jump bookmark, reset watchTime
   * 4. Accumulate watchTime
   * 5. Check isProgressCommittable
   * 6. If not committable: skip
   * 7. If committable: update tracking, buffer remote write
   *
   * @param {string} itemId
   * @param {string} localId
   * @param {{ playhead: number, duration: number, percent: number, watchTime: number }} progressData
   */
  async onProgressUpdate(itemId, localId, progressData) {
    const { playhead, duration, percent, watchTime } = progressData;

    // 1. Get or create tracking entry
    if (!this._skepticalMap.has(itemId)) {
      this._skepticalMap.set(itemId, {
        lastCommittedPlayhead: 0,
        watchTimeAccumulated: 0,
        storagePath: null,
      });
    }
    const tracking = this._skepticalMap.get(itemId);

    // 2. Calculate jump distance
    const jumpDistance = Math.abs(playhead - tracking.lastCommittedPlayhead);

    // 3. Large jump with existing progress: save pre-jump bookmark
    //    Only trigger on a NEW large jump (not while accumulating watch time at the same target)
    if (jumpDistance > LARGE_JUMP_THRESHOLD && tracking.lastCommittedPlayhead > 0) {
      const isNewJump = tracking.skepticalTarget == null ||
        Math.abs(playhead - tracking.skepticalTarget) > LARGE_JUMP_THRESHOLD;

      if (isNewJump) {
        this.#savePreJumpBookmark(itemId, tracking.lastCommittedPlayhead, duration, tracking.storagePath);
        tracking.watchTimeAccumulated = 0;
        tracking.skepticalTarget = playhead;
      }
    }

    // 4. Accumulate watch time
    tracking.watchTimeAccumulated += watchTime;

    // 5. Check committability
    const result = isProgressCommittable({
      sessionWatchTime: tracking.watchTimeAccumulated,
      lastCommittedPlayhead: tracking.lastCommittedPlayhead,
      newPlayhead: playhead,
    });

    // 6. Not committable — skip
    if (!result.committable) {
      return;
    }

    // 7. Committable — update tracking and buffer remote write
    tracking.lastCommittedPlayhead = playhead;
    tracking.watchTimeAccumulated = 0;
    tracking.skepticalTarget = null;

    this.#bufferRemoteWrite(itemId, localId, {
      currentTime: playhead,
      isFinished: percent >= 90,
    });
  }

  /**
   * Called on SIGTERM. Immediately writes all pending debounced updates to remote.
   *
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<void>}
   */
  async flush(timeoutMs = 5000) {
    const entries = [...this._debounceMap.entries()];
    this._debounceMap.clear();

    // Cancel all timers
    for (const [, entry] of entries) {
      clearTimeout(entry.timer);
    }

    if (entries.length === 0) return;

    const promises = entries.map(([itemId, entry]) => {
      const write = this.#remoteProgressProvider.updateProgress(entry.localId, entry.latestProgress);

      // Apply timeout
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Flush timeout for ${itemId}`)), timeoutMs),
      );

      return Promise.race([write, timeout]).catch((err) => {
        this.#logger.error(`[ProgressSync] flush error for ${itemId}:`, err.message);
      });
    });

    await Promise.allSettled(promises);
  }

  /**
   * Clean up all timers. Call when service is no longer needed.
   */
  dispose() {
    for (const [, entry] of this._debounceMap) {
      clearTimeout(entry.timer);
    }
    this._debounceMap.clear();
    this._skepticalMap.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Wraps remoteProgressProvider.getProgress with try/catch -> null on error
   * @param {string} localId
   * @returns {Promise<Object|null>}
   */
  async #fetchRemoteProgress(localId) {
    try {
      return await this.#remoteProgressProvider.getProgress(localId);
    } catch (err) {
      this.#logger.warn(`[ProgressSync] failed to fetch remote progress for ${localId}:`, err.message);
      return null;
    }
  }

  /**
   * Manages debounceMap with 30s timer for buffered remote writes.
   * @param {string} itemId
   * @param {string} localId
   * @param {Object} progress - { currentTime, isFinished }
   */
  #bufferRemoteWrite(itemId, localId, progress) {
    // Cancel existing timer if any
    const existing = this._debounceMap.get(itemId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      this._debounceMap.delete(itemId);
      try {
        await this.#remoteProgressProvider.updateProgress(localId, progress);
      } catch (err) {
        this.#logger.error(`[ProgressSync] debounced write failed for ${itemId}:`, err.message);
      }
    }, DEBOUNCE_MS);

    this._debounceMap.set(itemId, {
      timer,
      localId,
      latestProgress: progress,
    });
  }

  /**
   * Fire-and-forget bookmark save for pre-jump position.
   * @param {string} itemId
   * @param {number} playhead
   * @param {number} duration
   * @param {string|null} storagePath
   */
  #savePreJumpBookmark(itemId, playhead, duration, storagePath) {
    // Fire-and-forget: get current progress, add bookmark, save
    this.#mediaProgressMemory.get(itemId, storagePath).then((existing) => {
      if (!existing) return;

      const bookmarked = new MediaProgress({
        itemId: existing.itemId,
        playhead: existing.playhead,
        duration: existing.duration,
        playCount: existing.playCount,
        lastPlayed: existing.lastPlayed,
        watchTime: existing.watchTime,
        bookmark: {
          playhead,
          reason: 'pre-jump',
          createdAt: new Date().toISOString(),
        },
      });
      return this.#mediaProgressMemory.set(bookmarked, storagePath);
    }).catch((err) => {
      this.#logger.warn(`[ProgressSync] pre-jump bookmark save failed for ${itemId}:`, err.message);
    });
  }
}

export default ProgressSyncService;
