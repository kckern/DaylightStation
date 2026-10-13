/** Semantic read facade over registered content sources. */
export class ContentDiscoveryService {
  constructor({ contentCatalog, logger = console }) {
    if (!contentCatalog?.getItem) throw new Error('ContentDiscoveryService requires contentCatalog');
    this.contentCatalog = contentCatalog;
    this.logger = logger;
  }

  async getItem(source, localId) {
    const resolved = this.contentCatalog.resolveSource(source, localId);
    if (!resolved) return { kind: 'unknown_source' };
    const resolvedLocalId = resolved.localId;
    const item = await this.contentCatalog.getItem(resolved);
    return item
      ? { kind: 'found', item, localId: resolvedLocalId }
      : { kind: 'not_found', localId: resolvedLocalId };
  }

  getSources() {
    return {
      sources: this.contentCatalog.sourceNames(),
      categories: this.contentCatalog.categories(),
      providers: this.contentCatalog.providers(),
    };
  }

  getCategories() {
    return this.contentCatalog.categories();
  }

  async searchLegacy({ requestedSources, query }) {
    const searchable = [];
    for (const sourceName of this.contentCatalog.sourceNames()) {
      if (requestedSources && !requestedSources.includes(sourceName)) continue;
      if (this.contentCatalog.isSourceSearchable(sourceName)) searchable.push(sourceName);
    }
    if (searchable.length === 0) return { kind: 'none' };

    const items = [];
    let total = 0;
    const sources = [];
    for (const name of searchable) {
      try {
        const result = await this.contentCatalog.search(name, query);
        sources.push(name);
        total += result.total || result.items?.length || 0;
        items.push(...(result.items || []).map((item) => ({ ...item, source: item.source || name })));
      } catch (error) {
        this.logger.warn?.('content.search.adapter.error', { source: name, error: error.message });
      }
    }
    return { kind: 'found', query, sources, total, items };
  }
}

export default ContentDiscoveryService;
