/** Semantic content resolution facade for display, info, and queue queries. */
export class ContentAccessService {
  constructor({ contentIdResolver, contentCatalog, queueService = null }) {
    if (!contentIdResolver?.resolve) throw new Error('ContentAccessService requires contentIdResolver');
    if (!contentCatalog?.getItem) throw new Error('ContentAccessService requires contentCatalog');
    this.resolver = contentIdResolver; this.catalog = contentCatalog; this.queueService = queueService;
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
      items: await this.queueService.resolveQueue(playables, source, { shuffle }),
    };
  }
}

export default ContentAccessService;
