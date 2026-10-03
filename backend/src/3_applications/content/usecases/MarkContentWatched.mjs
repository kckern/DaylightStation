/**
 * Mark an item watched or unwatched (RQ-FIND-13).
 *
 * The mark is written as the SAME completion state playback writes, so every
 * existing reader agrees with it without knowing marks exist:
 *   - watched   → playhead = duration, percent 100 (>= the 90% line that
 *                 MediaProgress.isWatched, Plex next-episode selection and
 *                 resolveProgressConflict all use), completedAt stamped if it
 *                 was never set;
 *   - unwatched → playhead 0, percent 0, completedAt cleared. This is the one
 *                 deliberate exception to "completedAt is never cleared": the
 *                 rule protects first completion from playback writes, and a
 *                 person saying "I have not seen this" overrides it.
 * Both close every screen's spot (`spots: {}`) so the item leaves carry-on;
 * `lastDevice`, `lastPlayed`, `playCount` and `watchTime` are kept — marking
 * is not playing.
 *
 * Every namespace that already holds the item is updated (an item played from
 * a watchlist lives under the list's namespace as well as its source's); an
 * item never played is written to its source namespace.
 *
 * Remote-synced sources (progressSyncSources, e.g. Audiobookshelf) receive
 * the mark at once via ProgressSyncService.pushMarkedState. Failure there is
 * logged and does not undo the local mark.
 */
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class MarkContentWatched {
  constructor({
    contentCatalog,
    mediaProgressMemory,
    progressSyncSources = new Set(),
    progressSyncService = null,
    nowTimestamp,
    nowEpoch = () => Date.now(),
    logger = console,
  }) {
    if (!mediaProgressMemory) throw new Error('MarkContentWatched requires mediaProgressMemory');
    if (typeof nowTimestamp !== 'function') throw new Error('MarkContentWatched requires nowTimestamp');
    this.contentCatalog = contentCatalog;
    this.mediaProgressMemory = mediaProgressMemory;
    this.progressSyncSources = progressSyncSources;
    this.progressSyncService = progressSyncService;
    this.nowTimestamp = nowTimestamp;
    this.nowEpoch = nowEpoch;
    this.logger = logger;
  }

  /**
   * @param {{contentId:string, watched:boolean}} input
   * @returns {Promise<{contentId:string, watched:boolean, namespaces:string[], playhead:number, duration:number, percent:number, completedAt:string|null}>}
   */
  async execute({ contentId, watched }) {
    const id = typeof contentId === 'string' ? contentId.trim() : '';
    const colon = id.indexOf(':');
    if (colon <= 0) {
      throw new ValidationError('contentId must carry its source (<source>:<localId>)', { code: 'INVALID_CONTENT_ID', field: 'contentId' });
    }
    const source = id.slice(0, colon);
    const resolved = this.contentCatalog?.resolveSource?.(source, id) || null;

    const holders = await this.#namespacesHolding(id);
    let targets = holders;
    if (!targets.length) {
      let namespace = source;
      if (resolved) {
        try {
          namespace = (await this.contentCatalog.progressNamespace(resolved, id)) || source;
        } catch (error) {
          this.logger.warn?.('media.mark.namespace_failed', { contentId: id, error: error.message });
        }
      }
      targets = [{ namespaceId: namespace, progress: null }];
    }

    let catalogDuration;
    const durationFor = async (existing) => {
      if (existing?.duration > 0) return existing.duration;
      if (catalogDuration === undefined) catalogDuration = await this.#catalogDuration(resolved, id);
      return catalogDuration;
    };

    const at = this.nowTimestamp();
    let last = null;
    for (const { namespaceId, progress: existing } of targets) {
      const duration = await durationFor(existing);
      const state = new MediaProgress({
        contentId: id,
        playhead: watched ? duration : 0,
        duration,
        percent: watched ? 100 : 0,
        playCount: existing?.playCount ?? 0,
        lastPlayed: existing?.lastPlayed ?? null,
        watchTime: existing?.watchTime ?? 0,
        completedAt: watched ? (existing?.completedAt || at) : null,
        spots: {},
        lastDevice: existing?.lastDevice ?? null,
        now: this.nowEpoch(),
      });
      await this.mediaProgressMemory.saveProgress(state, namespaceId);
      last = state;
    }

    if (this.progressSyncSources?.has?.(source) && typeof this.progressSyncService?.pushMarkedState === 'function') {
      const localId = resolved?.localId || id.slice(colon + 1);
      try {
        await this.progressSyncService.pushMarkedState(id, localId, {
          currentTime: watched ? (last?.duration || 0) : 0,
          isFinished: !!watched,
        });
      } catch (error) {
        this.logger.warn?.('media.mark.remote_push_failed', { contentId: id, error: error.message });
      }
    }

    const namespaces = targets.map((t) => t.namespaceId);
    this.logger.info?.('media.mark.written', { contentId: id, watched: !!watched, namespaces });
    return {
      contentId: id,
      watched: !!watched,
      namespaces,
      playhead: last.playhead,
      duration: last.duration,
      percent: last.percent,
      completedAt: last.completedAt,
    };
  }

  async #namespacesHolding(contentId) {
    if (typeof this.mediaProgressMemory.listAllProgress !== 'function') return [];
    const all = await this.mediaProgressMemory.listAllProgress();
    return all.filter((entry) => entry.progress?.contentId === contentId);
  }

  async #catalogDuration(resolved, contentId) {
    if (!resolved || typeof this.contentCatalog?.getItem !== 'function') return 0;
    try {
      const item = await this.contentCatalog.getItem(resolved, contentId);
      // Same convention as RecordPlaybackProgress: catalog metadata durations
      // are milliseconds.
      const ms = Number(item?.metadata?.duration);
      return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
    } catch (error) {
      this.logger.warn?.('media.mark.duration_lookup_failed', { contentId, error: error.message });
      return 0;
    }
  }
}

export default MarkContentWatched;
