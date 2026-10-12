import { sequenceQueue } from '../domain/utils/stationSequence.mjs';

/** Semantic content resolution facade for display, info, and queue queries. */
export class ContentAccessService {
  /**
   * @param {Object} deps
   * @param {Object} [deps.sequenceStore] - ISequenceStore; station sequences apply only when present
   * @param {() => number} [deps.random] - Injected entropy for station-ID spacing; required with sequenceStore
   * @param {Object} [deps.logger]
   */
  constructor({ contentIdResolver, contentCatalog, queueService = null, sequenceStore = null, random = null, logger = null }) {
    if (!contentIdResolver?.resolve) throw new Error('ContentAccessService requires contentIdResolver');
    if (!contentCatalog?.getItem) throw new Error('ContentAccessService requires contentCatalog');
    this.resolver = contentIdResolver; this.catalog = contentCatalog; this.queueService = queueService;
    if (sequenceStore && typeof random !== 'function') throw new Error('ContentAccessService: sequenceStore requires an injected random');
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

  async queue({ compoundId, parsedSource, localId, shuffle }) {
    let resolved = this.resolver.resolve(compoundId);
    if (!resolved && !localId && parsedSource) resolved = this.resolver.resolve(parsedSource);
    if (!resolved && !localId && parsedSource) resolved = this.resolver.resolve(`query:${parsedSource}`);
    const source = resolved?.source ?? parsedSource;
    if (!resolved) return { kind: 'unknown_source', source };
    const finalId = `${resolved.source}:${resolved.localId}`;
    const playables = await this.catalog.resolvePlayables(resolved, finalId);
    if (playables === null) return { kind: 'unsupported', source };
    return {
      kind: 'found', source, finalId, audio: playables.audio || null,
      thumbnail: playables.thumbnail || null,
      items: await this.#orderQueue(playables, source, finalId, shuffle),
    };
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

  /** Resolve each id to its first playable; null for anything that does not resolve. */
  async #resolveIds(ids) {
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const resolved = this.resolver.resolve(id);
        if (!resolved) return [id, null];
        const found = await this.catalog.resolvePlayables(resolved, id);
        const list = Array.isArray(found) ? found : found?.items;
        return [id, list?.[0] ?? null];
      } catch {
        return [id, null];
      }
    }));
    return new Map(entries);
  }
}

export default ContentAccessService;
