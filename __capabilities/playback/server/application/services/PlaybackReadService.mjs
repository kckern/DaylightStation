/** Resolve playback reads and build their public DTO without exposing adapters to HTTP. */
export class PlaybackReadService {
  /**
   * @param {Object} deps
   * @param {(playables: Array) => boolean} [deps.isOrderedWork] - true for a book, a talk
   *   series or a course heard as audio (QueueService.isOrderedWork, library kinds). Such a
   *   work ignores shuffle here as it does in the queue. Absent = nothing is ordered.
   */
  constructor({ contentIdResolver, contentCatalog, contentQueryService = null, playResponseService, isOrderedWork = null, random = Math.random, now = () => new Date(), logger = console }) {
    this.contentIdResolver = contentIdResolver;
    this.contentCatalog = contentCatalog;
    this.contentQueryService = contentQueryService;
    this.playResponseService = playResponseService;
    this.isOrderedWork = typeof isOrderedWork === 'function' ? isOrderedWork : null;
    this.random = random;
    this.now = now;
    this.logger = logger;
  }

  async getPlexManifest(id, options) {
    return this.contentCatalog.playbackManifest('plex', id, options);
  }

  async resolve({ compoundId, shuffle = false, resume, session, bookmark = false, quality = {} }) {
    const resolved = this.contentIdResolver.resolve(compoundId);
    if (!resolved) return { kind: 'unknown_source' };
    const { source, localId } = resolved;

    // A book is never shuffled: a random part of it is not a place to start. The
    // queue route already plays an ordered work in order (QueueService); the play
    // route does the same, so Play with shuffle on starts where the listener is.
    if (shuffle && await this.#orderedWork(resolved)) {
      this.logger.info?.('play.shuffle.ignored_ordered_work', { compoundId });
      shuffle = false;
    }

    if (shuffle) {
      let selectedItem;
      if (this.contentQueryService) {
        const result = await this.contentQueryService.resolve(source, localId, { now: this.now() }, { pick: 'random', allowFallback: true });
        if (!result.items.length) return { kind: 'no_playables' };
        selectedItem = result.items[0];
      } else {
        const playables = await this.contentCatalog.resolvePlayables(resolved);
        if (playables === null) return { kind: 'no_playables' };
        if (!playables.length) return { kind: 'no_playables' };
        selectedItem = playables[Math.floor(this.random() * playables.length)];
      }
      return { kind: 'found', body: await this.#response(selectedItem, resolved, { resume, session, quality }) };
    }

    const item = await this.contentCatalog.getItem(resolved);
    if (!item) return { kind: 'item_not_found', source, localId, adapterSource: source };
    if (item.isContainer?.() || item.itemType === 'container') {
      let playables;
      if (this.contentQueryService) {
        try {
          // `allowFallback`: PLAY a container, never refuse it. The selection
          // strategy drops watched items, which is right for "what's next" —
          // and made a season whose every episode was finished answer 404 "No
          // playable items in container" (2026-09-14, plex:696233, all three
          // Études at 100%). The fallback relaxes the filters only when they
          // leave nothing, so an unfinished container still resumes where it was.
          const result = await this.contentQueryService.resolve(source, localId, { now: this.now() }, { allowFallback: true });
          playables = result.items;
        } catch {
          playables = await this.contentCatalog.resolvePlayables(resolved) || [];
        }
      } else playables = await this.contentCatalog.resolvePlayables(resolved) || [];
      if (!playables.length) return { kind: 'empty_container' };
      return {
        kind: 'found',
        body: await this.#response(playables[0], resolved, {
          resume,
          session,
          quality,
          containerId: `${source}:${localId}`,
        }),
      };
    }

    const progressNamespace = await this.contentCatalog.progressNamespace(resolved, item.id);
    const watchState = await this.playResponseService.getWatchState(item, progressNamespace, source);
    if (bookmark && watchState?.bookmark) watchState.playhead = watchState.bookmark.playhead;
    const descriptor = this.contentCatalog.describeItem(item, resolved, session, quality);
    return { kind: 'found', body: this.playResponseService.toPlayResponse(item, watchState, { descriptor, resume, session, quality }) };
  }

  /**
   * Where a direct play of `compoundId` would start, read-only (nothing is
   * bookmarked or synced). `startSec` is null when it cannot be known ahead:
   * an unknown id, a missing item, or a container (its pick happens at play).
   * `lastPlayedAt`: when the title was last played (ISO), or null.
   * @returns {Promise<{ startSec: number|null, lastPlayedAt: string|null }>}
   */
  async peekStartPosition({ compoundId }) {
    const unknown = { startSec: null, lastPlayedAt: null };
    const resolved = this.contentIdResolver.resolve(compoundId);
    if (!resolved) return unknown;
    const item = await this.contentCatalog.getItem(resolved);
    if (!item || item.isContainer?.() || item.itemType === 'container') return unknown;
    const progressNamespace = await this.contentCatalog.progressNamespace(resolved, item.id);
    const watchState = await this.playResponseService.peekWatchState(item, progressNamespace, resolved.source);
    return {
      startSec: this.playResponseService.startPositionFor(item, watchState),
      lastPlayedAt: watchState?.lastPlayed ? String(watchState.lastPlayed) : null,
    };
  }

  async #orderedWork(resolved) {
    if (!this.isOrderedWork || typeof this.contentCatalog.resolvePlayables !== 'function') return false;
    try {
      const playables = await this.contentCatalog.resolvePlayables(resolved);
      return Array.isArray(playables) && playables.length > 0 && this.isOrderedWork(playables) === true;
    } catch (error) {
      this.logger.warn?.('play.shuffle.ordered_check_failed', { error: error?.message });
      return false;
    }
  }

  async #response(item, resolution, options) {
    const progressNamespace = await this.contentCatalog.progressNamespace(resolution, item.id);
    const watchState = await this.playResponseService.getWatchState(item, progressNamespace, resolution.source);
    const descriptor = this.contentCatalog.describeItem(item, resolution, options.session, options.quality);
    return this.playResponseService.toPlayResponse(item, watchState, { descriptor, ...options });
  }
}

export default PlaybackReadService;
