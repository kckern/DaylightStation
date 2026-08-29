import { IFitnessContentCatalog } from '#apps/fitness/ports/IFitnessContentCatalog.mjs';

const text = (value) => value == null ? '' : String(value);

/** Anti-corruption adapter from a provider content plugin to Fitness concepts. */
export class ProviderFitnessContentCatalog extends IFitnessContentCatalog {
  constructor({ contentAdapter, contentQueryService = null, source, fitnessLibraryId = 14, timeout = setTimeout, logger = console }) {
    super();
    if (!contentAdapter) throw new Error('ProviderFitnessContentCatalog requires contentAdapter');
    this.contentAdapter = contentAdapter;
    this.contentQueryService = contentQueryService;
    this.source = source || contentAdapter.source;
    this.timeout = timeout;
    this.fitnessLibraryId = fitnessLibraryId;
    this.logger = logger;
    if (!this.source) throw new Error('ProviderFitnessContentCatalog requires a content source name');
  }

  canonicalize(contentId) {
    const prefix = `${this.source}:`;
    let localId = text(contentId);
    while (localId.startsWith(prefix)) localId = localId.slice(prefix.length);
    return { contentId: `${prefix}${localId}`, localId, source: this.source };
  }

  async resolvePlayables(contentId) {
    const items = await this.contentAdapter.resolvePlayables(this.canonicalize(contentId).contentId);
    return (items || []).map((item) => ({
      ...item,
      metadata: {
        ...(item.metadata || {}),
        completedPlayCount: item.metadata?.viewCount ?? item.metadata?.completedPlayCount ?? 0,
        showContentId: item.metadata?.grandparentRatingKey != null
          ? this.canonicalize(item.metadata.grandparentRatingKey).contentId
          : (item.metadata?.grandparentId != null
            ? this.canonicalize(item.metadata.grandparentId).contentId
            : item.metadata?.showContentId ?? null),
      },
    }));
  }

  async enrichWatchState(items, contentId) {
    if (!this.contentQueryService) return items;
    const ref = this.canonicalize(contentId);
    return this.contentQueryService.enrichWithWatchState(items, ref.source, ref.contentId);
  }

  async getContainerInfo(contentId) {
    if (!this.contentAdapter.getContainerInfo) return null;
    const info = await this.contentAdapter.getContainerInfo(this.canonicalize(contentId).contentId);
    if (!info) return info;
    const parentLocalId = info.parentRatingKey ?? info.parentId ?? null;
    return {
      ...info,
      parentContentId: parentLocalId == null ? null : this.canonicalize(parentLocalId).contentId,
    };
  }

  async getItem(contentId) {
    return this.contentAdapter.getItem
      ? this.contentAdapter.getItem(this.canonicalize(contentId).contentId)
      : null;
  }

  async listConfiguredShows() {
    const items = await this.contentAdapter.getList(`library/sections/${this.fitnessLibraryId}/all`);
    const shows = (items || []).map((item) => ({
      id: text(item.localId || item.id).replace(`${this.source}:`, ''),
      title: item.title,
      type: item.itemType || item.metadata?.type,
      episodeCount: item.metadata?.leafCount || item.metadata?.childCount || item.childCount || null,
    }));
    return { shows, libraryId: this.fitnessLibraryId };
  }

  async collectionShowIds(collectionId) {
    if (!this.contentAdapter.getList) return [];
    const items = await this.contentAdapter.getList(text(collectionId));
    return (items || []).flatMap((item) => {
      const raw = item?.metadata?.grandparentRatingKey
        ?? item?.metadata?.grandparentId
        ?? item?.localId
        ?? (typeof item?.id === 'string' ? item.id : null);
      return raw == null ? [] : [this.canonicalize(raw).localId];
    }).filter(Boolean);
  }

  async describeItem(contentId) {
    const item = await this.getItem(contentId);
    const info = await this.getContainerInfo(contentId);
    return {
      title: item?.title ?? null,
      description: item?.metadata?.summary ?? null,
      labels: Array.isArray(info?.labels) ? info.labels : [],
    };
  }

  /**
   * Preserve the legacy raw config shape while keeping its provider-specific
   * keys and thumbnail lookup protocol behind the fitness content boundary.
   */
  async enrichConfiguredPlaylists(config) {
    const playlists = config?.plex?.music_playlists;
    if (!Array.isArray(playlists) || playlists.length === 0 || !this.contentAdapter?.getThumbnail) {
      return config;
    }

    const enrichment = Promise.all(playlists.map(async (playlist) => {
      if (playlist.thumb || playlist.thumbnail || !playlist.id) return playlist;
      try {
        const thumb = await this.contentAdapter.getThumbnail(playlist.id);
        return { ...playlist, thumb };
      } catch {
        return playlist;
      }
    }));

    try {
      const timeout = new Promise((_, reject) => {
        const timer = this.timeout(() => reject(new Error('thumbnail enrichment timeout')), 1500);
        timer?.unref?.();
      });
      config.plex.music_playlists = await Promise.race([enrichment, timeout]);
    } catch (error) {
      this.logger.warn?.('fitness.config.thumbnail-enrichment-failed', { error: error.message });
    }
    return config;
  }

  async getGovernedItems(labels, options) {
    if (!this.contentAdapter?.getItemsByLabel) return [];
    return this.contentAdapter.getItemsByLabel(labels, options);
  }
}

export default ProviderFitnessContentCatalog;
