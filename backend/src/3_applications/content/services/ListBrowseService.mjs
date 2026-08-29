/** Resolve and prepare a list browse operation without exposing source adapters to HTTP. */
export class ListBrowseService {
  constructor({ contentCatalog, contentIdResolver, contentQueryService = null, menuMemory = null, random = Math.random, logger = console }) {
    if (!contentCatalog?.getList) throw new Error('ListBrowseService requires contentCatalog');
    this.contentCatalog = contentCatalog;
    this.contentIdResolver = contentIdResolver;
    this.contentQueryService = contentQueryService;
    this.menuMemory = menuMemory;
    this.random = random;
    this.logger = logger;
  }

  getSourceNames() {
    return this.contentCatalog.sourceNames();
  }

  async browse({ source, localId, modifiers }) {
    const resolved = this.contentIdResolver.resolve(`${source}:${localId}`);
    const resolvedLocalId = resolved?.localId ?? localId;
    const resolvedSource = resolved?.source ?? source;

    if (!resolved) {
      const categorySources = !localId ? this.contentCatalog.sourcesByCategory(source) : [];
      if (categorySources.length === 0) return { kind: 'unknown_source' };
      const lists = await Promise.all(categorySources.map(async (categorySource) => {
        try {
          const address = this.contentCatalog.resolveSource(categorySource, '');
          const result = await this.contentCatalog.getList(address, `${categorySource}:`);
          if (Array.isArray(result)) return result;
          return result?.items || result?.children || [];
        } catch (error) {
          this.logger.warn?.('list.category_source_failed', {
            category: source,
            source: categorySource,
            error: error.message,
          });
          return [];
        }
      }));
      const items = lists.flat();
      this.logger.info?.('list.category_fallback', {
        category: source,
        sources: categorySources,
        itemCount: items.length,
      });
      return { kind: 'category', items };
    }

    const resolvedViaPrefix = resolvedSource !== source;
    const compoundId = resolvedViaPrefix ? resolvedLocalId : `${source}:${resolvedLocalId}`;
    let items;
    if (modifiers.launchable) {
      items = await this.contentCatalog.resolveLaunchables(resolved, compoundId);
      if (items === null) return { kind: 'unsupported_launchable' };
    } else if (modifiers.playable) {
      items = await this.contentCatalog.resolvePlayables(resolved, compoundId);
      if (items === null) return { kind: 'unsupported_playable' };
    } else {
      const result = await this.contentCatalog.getList(resolved, compoundId);
      if (Array.isArray(result)) items = result;
      else if (Array.isArray(result?.children)) items = result.children;
      else if (Array.isArray(result?.items)) items = result.items;
      else items = [];
    }

    if (this.contentQueryService) {
      const enriched = await this.contentQueryService.enrichWithWatchState(items, source, compoundId);
      items = enriched.map((item) => ({
        ...item,
        watchProgress: item.percent ?? null,
        watchSeconds: item.playhead ?? null,
        watchedDate: item.lastPlayed ?? null,
      }));
    }

    const hasFixedOrder = items.some((item) => item.metadata?.fixedOrder);
    if (modifiers.shuffle && !hasFixedOrder) items = shuffle([...items], this.random);
    if (modifiers.recent_on_top && !hasFixedOrder) {
      const values = this.menuMemory?.getAll?.() || {};
      items = [...items].sort((a, b) => (values[getMenuMemoryKey(b)] || 0) - (values[getMenuMemoryKey(a)] || 0));
    }

    const containerInfo = await this.contentCatalog.getItem(resolved, compoundId);
    const info = await this.contentCatalog.getContainerInfo(resolved, compoundId);
    return { kind: 'found', items, containerInfo, info, compoundId };
  }
}

function getMenuMemoryKey(item) {
  const action = item.actions?.play || item.actions?.queue || item.actions?.list || item.actions?.open
    || item.play || item.queue || item.list || item.open;
  if (!action) return null;
  return Object.values(action)[0] ?? null;
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

export default ListBrowseService;
