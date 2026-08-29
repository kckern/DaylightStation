/** Resolve playback reads and build their public DTO without exposing adapters to HTTP. */
export class PlaybackReadService {
  constructor({ contentIdResolver, contentCatalog, contentQueryService = null, playResponseService, random = Math.random, now = () => new Date(), logger = console }) {
    this.contentIdResolver = contentIdResolver;
    this.contentCatalog = contentCatalog;
    this.contentQueryService = contentQueryService;
    this.playResponseService = playResponseService;
    this.random = random;
    this.now = now;
    this.logger = logger;
  }

  async getPlexManifest(id, options) {
    return this.contentCatalog.playbackManifest('plex', id, options);
  }

  async resolve({ compoundId, shuffle = false, resume, session, bookmark = false }) {
    const resolved = this.contentIdResolver.resolve(compoundId);
    if (!resolved) return { kind: 'unknown_source' };
    const { source, localId } = resolved;

    if (shuffle) {
      let selectedItem;
      if (this.contentQueryService) {
        const result = await this.contentQueryService.resolve(source, localId, { now: this.now() }, { pick: 'random' });
        if (!result.items.length) return { kind: 'no_playables' };
        selectedItem = result.items[0];
      } else {
        const playables = await this.contentCatalog.resolvePlayables(resolved);
        if (playables === null) return { kind: 'no_playables' };
        if (!playables.length) return { kind: 'no_playables' };
        selectedItem = playables[Math.floor(this.random() * playables.length)];
      }
      return { kind: 'found', body: await this.#response(selectedItem, resolved, { resume, session }) };
    }

    const item = await this.contentCatalog.getItem(resolved);
    if (!item) return { kind: 'item_not_found', source, localId, adapterSource: source };
    if (item.isContainer?.() || item.itemType === 'container') {
      let playables;
      if (this.contentQueryService) {
        try {
          const result = await this.contentQueryService.resolve(source, localId, { now: this.now() });
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
          containerId: `${source}:${localId}`,
        }),
      };
    }

    const progressNamespace = await this.contentCatalog.progressNamespace(resolved, item.id);
    const watchState = await this.playResponseService.getWatchState(item, progressNamespace, source);
    if (bookmark && watchState?.bookmark) watchState.playhead = watchState.bookmark.playhead;
    const descriptor = this.contentCatalog.describeItem(item, resolved, session);
    return { kind: 'found', body: this.playResponseService.toPlayResponse(item, watchState, { descriptor, resume, session }) };
  }

  async #response(item, resolution, options) {
    const progressNamespace = await this.contentCatalog.progressNamespace(resolution, item.id);
    const watchState = await this.playResponseService.getWatchState(item, progressNamespace, resolution.source);
    const descriptor = this.contentCatalog.describeItem(item, resolution, options.session);
    return this.playResponseService.toPlayResponse(item, watchState, { descriptor, ...options });
  }
}

export default PlaybackReadService;
