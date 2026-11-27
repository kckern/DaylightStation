import { sequenceQueue } from '../domain/utils/stationSequence.mjs';

/** What an audio library may hold (play_on_demand.library_kinds). */
const AUDIO_LIBRARY_KINDS = new Set(['music', 'books', 'talks']);

/** Semantic content resolution facade for display, info, and queue queries. */
export class ContentAccessService {
  /**
   * @param {Object} deps
   * @param {Object} [deps.sequenceStore] - ISequenceStore; station sequences apply only when present
   * @param {() => number} [deps.random] - Injected entropy for station-ID spacing; required with sequenceStore
   * @param {Object} [deps.logger]
   */
  constructor({ contentIdResolver, contentCatalog, queueService = null, audioListConfig = () => null, sequenceStore = null, random = null, logger = null }) {
    if (!contentIdResolver?.resolve) throw new Error('ContentAccessService requires contentIdResolver');
    if (!contentCatalog?.getItem) throw new Error('ContentAccessService requires contentCatalog');
    this.resolver = contentIdResolver; this.catalog = contentCatalog; this.queueService = queueService;
    if (sequenceStore && typeof random !== 'function') throw new Error('ContentAccessService: sequenceStore requires an injected random');
    this.audioListConfig = audioListConfig;
    this.sequenceStore = sequenceStore; this.random = random; this.logger = logger;
  }

  async display(compoundId, parsedSource, parsedLocalId) {
    const resolved = this.resolver.resolve(compoundId);
    const sourceName = resolved?.source ?? parsedSource;
    const localId = resolved?.localId ?? parsedLocalId;
    if (!resolved) return { kind: 'unknown_source', source: sourceName };
    if (!localId) return { kind: 'missing_id' };
    try {
      let thumbnailUrl = await this.catalog.getThumbnailUrl(resolved);
      let title;
      if (!thumbnailUrl) {
        const item = await this.catalog.getItem(resolved, compoundId);
        thumbnailUrl = item?.thumbnail || item?.imageUrl; title = item?.title;
      }
      return { kind: 'found', source: sourceName, localId, thumbnailUrl, title };
    } catch (error) { return { kind: 'failed', error }; }
  }

  async info(compoundId, fallbackSource) {
    const resolved = this.resolver.resolve(compoundId);
    if (!resolved) return { kind: 'unknown_source', source: fallbackSource };
    const item = await this.catalog.getItem(resolved);
    if (!item) return { kind: 'not_found', source: resolved.source, localId: resolved.localId };
    return {
      kind: 'found', item, source: resolved.source, localId: resolved.localId,
      format: this.catalog.describeItem(item, resolved).format,
      capabilities: this.catalog.capabilities(item, resolved),
    };
  }

  audioListSources() {
    const available = this.catalog.audioListSources?.() ?? [];
    const configured = this.audioListConfig()?.sources;
    if (!Array.isArray(configured)) return available;
    const known = new Map(available.map(source => [source.id, source]));
    return configured.flatMap(entry => {
      const source = known.get(typeof entry === 'string' ? entry : entry?.id);
      if (!source) return [];
      return [{ ...source, title: entry?.title || source.title }];
    });
  }

  audioBrowse() {
    const entries = this.audioListConfig()?.browse;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(entry => {
      if (typeof entry?.id !== 'string' || typeof entry?.title !== 'string'
          || !entry.title.trim() || !this.resolver.resolve(entry.id)) return [];
      return [{ id: entry.id, title: entry.title.trim() }];
    });
  }

  /**
   * The audio libraries and what each holds: music, books, or talks (talks and courses).
   * The household media config's `play_on_demand.library_kinds` names a library (by its
   * title or its Plex section id) and its kind; a library not named is music. This is
   * the one place the phone learns a library's kind: it never reads it from a title.
   * @returns {Promise<Array<{id:string, title:string, sectionId:string|null, kind:string}>>}
   */
  async audioLibraries() {
    const configured = this.audioListConfig()?.library_kinds;
    const kinds = new Map();
    if (configured && typeof configured === 'object') {
      for (const [key, value] of Object.entries(configured)) {
        const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (AUDIO_LIBRARY_KINDS.has(kind)) kinds.set(String(key).trim().toLowerCase(), kind);
      }
    }
    const resolution = this.resolver.resolve('plex:audio');
    if (!resolution) return [];
    const result = await this.catalog.getList(resolution, 'audio');
    const libraries = Array.isArray(result) ? result : result?.items ?? result?.children ?? [];
    return libraries.flatMap((library) => {
      if (!library?.id || !library?.title) return [];
      const sectionId = library.metadata?.sectionId != null ? String(library.metadata.sectionId) : null;
      const kind = (sectionId && kinds.get(sectionId)) || kinds.get(String(library.title).trim().toLowerCase()) || 'music';
      return [{ id: library.id, title: library.title, sectionId, kind }];
    });
  }

  async audioListCatalog({ source, skip, take }) {
    const id = source.includes(':') ? source : `${source}:`;
    if (!this.audioListSources().some(entry => entry.id === id)) return null;
    const resolution = this.resolver.resolve(id);
    if (!resolution) return null;
    const specialized = await this.catalog.audioListPage?.(resolution, { skip, take });
    const result = specialized ? null : await this.catalog.getList(resolution, id);
    const candidates = Array.isArray(result) ? result : result?.items ?? result?.children ?? [];
    const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
    const page = specialized?.items ?? ordered.slice(skip, skip + take);
    const items = await Promise.all(page.map(async candidate => {
      try {
        if (specialized && !candidate.checkAudio) {
          return { id: candidate.id, title: candidate.title, thumbnail: candidate.thumbnail || null };
        }
        const resolution = this.resolver.resolve(candidate.id);
        let sequenced;
        if (resolution) {
          const ref = `${resolution.source}:${resolution.localId}`;
          try { sequenced = this.sequenceStore?.lookup(ref); } catch { sequenced = true; }
          if (!sequenced) {
            const sample = await this.catalog.findAudioListItem?.(resolution, ref,
              async item => (await this.#projectAudio([item]))[0]);
            if (sample !== undefined) {
              return sample ? {
                id: candidate.id, title: candidate.title,
                thumbnail: candidate.thumbnail || sample.thumbnail || null,
              } : null;
            }
          }
        }
        const queue = await this.queue({ compoundId: candidate.id, profile: 'audio-only' });
        if (!queue.items?.length) return null;
        return {
          id: candidate.id,
          title: candidate.title,
          thumbnail: candidate.thumbnail || queue.thumbnail || queue.items[0].thumbnail || null,
          // A radio-station playlist (a station sequence: station IDs between songs) plays whole.
          ...(sequenced && sequenced !== true ? { station: true } : {}),
        };
      } catch (error) {
        this.logger?.warn?.('queue.catalog.list_failed', { id: candidate.id, error: error.message });
        return null;
      }
    }));
    return { items: items.filter(Boolean), total: specialized?.total ?? ordered.length };
  }

  async queue({ compoundId, parsedSource, localId, shuffle, profile }) {
    let resolved = this.resolver.resolve(compoundId);
    if (!resolved && !localId && parsedSource) resolved = this.resolver.resolve(parsedSource);
    if (!resolved && !localId && parsedSource) resolved = this.resolver.resolve(`query:${parsedSource}`);
    const source = resolved?.source ?? parsedSource;
    if (!resolved) return { kind: 'unknown_source', source };
    const finalId = `${resolved.source}:${resolved.localId}`;
    const playables = await this.catalog.resolvePlayables(resolved, finalId);
    if (playables === null) return { kind: 'unsupported', source };
    const items = await this.#orderQueue(playables, source, finalId, shuffle);
    return {
      kind: 'found', source, finalId, audio: playables.audio || null,
      thumbnail: playables.thumbnail || null,
      items: profile === 'audio-only' ? await this.#projectAudio(items) : items,
    };
  }

  async #projectAudio(items) {
    const audioItems = [];
    for (const item of items) {
      if (item.mediaType === 'audio' && item.mediaUrl) {
        audioItems.push(item);
      } else if (['video', 'hls_video', 'dash_video'].includes(item.mediaType)) {
        const rendition = item.metadata?.audioRendition ?? await this.catalog.audioRendition?.(item);
        if (rendition?.mediaUrl && rendition.format) {
          audioItems.push({
            ...item,
            mediaType: 'audio',
            mediaUrl: rendition.mediaUrl,
            resumable: false, resumePosition: null,
            metadata: { ...item.metadata, contentFormat: rendition.format },
          });
        }
      }
    }
    return audioItems;
  }

  /**
   * Order a resolved container. A container with a station sequence (see
   * YamlSequenceStore) keeps its head pinned and gets station IDs between songs;
   * only the songs go through the queue policy, so watch-aware ordering can
   * never bury the jingle. Fails open: any fault returns the plain queue.
   */
  async #orderQueue(playables, source, finalId, shuffle) {
    const plain = () => this.queueService.resolveQueue(playables, source, { shuffle });
    let sequence = null;
    try {
      if (Array.isArray(playables) && playables.length) sequence = this.sequenceStore?.lookup(finalId) ?? null;
    } catch { sequence = null; }
    if (!sequence) return plain();

    try {
      const { items, stats } = await sequenceQueue({
        items: playables,
        sequence,
        random: this.random,
        // The songs keep the container's own flags (a program's preserveOrder).
        orderRest: (rest) => this.queueService.resolveQueue(
          Object.assign(rest, playables.preserveOrder ? { preserveOrder: true } : {}), source, { shuffle }),
        resolveIds: (ids) => this.#resolveIds(ids),
      });
      const { unresolved, ...counts } = stats;
      for (const id of unresolved) this.logger?.warn?.('station.ident.unresolved', { containerId: finalId, id });
      this.logger?.info?.('station.sequence.applied', { containerId: finalId, path: 'queue', shuffle, ...counts });
      return items;
    } catch (error) {
      this.logger?.warn?.('station.sequence.failed', { containerId: finalId, error: error?.message });
      return plain();
    }
  }

  /**
   * Resolve each id to its playables (a container gives all of them; the
   * sequence takes a head id's first and a pool id's every item); null for
   * anything that does not resolve.
   */
  async #resolveIds(ids) {
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const resolved = this.resolver.resolve(id);
        if (!resolved) return [id, null];
        const found = await this.catalog.resolvePlayables(resolved, id);
        const list = Array.isArray(found) ? found : found?.items;
        return [id, list?.length ? [...list] : null];
      } catch {
        return [id, null];
      }
    }));
    return new Map(entries);
  }
}

export default ContentAccessService;
