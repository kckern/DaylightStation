function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function menuKey(item) {
  const action = item.actions?.play || item.actions?.queue || item.actions?.list || item.actions?.open
    || item.play || item.queue || item.list || item.open;
  return action ? (Object.values(action)[0] || null) : null;
}

/** Application orchestration for the unified item surface. */
export class ItemService {
  constructor({ contentCatalog, contentQueryService = null, menuMemory, random = Math.random, clock = Date.now, logger = console }) {
    if (!contentCatalog?.getItem) throw new Error('ItemService requires contentCatalog');
    if (!menuMemory?.getAll || !menuMemory?.record) throw new Error('ItemService requires menuMemory');
    this.contentCatalog = contentCatalog;
    this.contentQueryService = contentQueryService;
    this.menuMemory = menuMemory;
    this.random = random;
    this.clock = clock;
    this.logger = logger;
  }

  async get({ source, localId, modifiers, selectStrategy }) {
    const resolution = this.contentCatalog.resolveSource(source, localId);
    if (!resolution) return { kind: 'unknown_source', source };
    const compoundId = `${source}:${localId}`;

    if (selectStrategy && this.contentQueryService) {
      try {
        const { items, strategy } = await this.contentQueryService.resolve(
          source, localId, { now: new Date(this.clock()) },
          { strategy: selectStrategy, allowFallback: true },
        );
        if (items.length === 0) {
          return { kind: 'selection_empty', source, localId, strategy: strategy.name };
        }
        const selected = items[0];
        let item = selected;
        if (!selected.content && selected.id) {
          const full = await this.contentCatalog.getItem(resolution, selected.id);
          if (full) {
            item = {
              ...full,
              percent: selected.percent,
              watched: selected.watched,
              playhead: selected.playhead,
              duration: selected.duration ?? full.duration,
            };
          }
        }
        return { kind: 'selected', item, strategy: strategy.name, totalCandidates: items.length };
      } catch (error) {
        this.logger.warn?.('item.select.error', { source, localId, strategy: selectStrategy, error: error.message });
      }
    }

    const item = await this.contentCatalog.getItem(resolution, compoundId);
    if (!item) return { kind: 'not_found', source, localId };
    const hasModifiers = modifiers.playable || modifiers.shuffle || modifiers.recent_on_top;
    if (!hasModifiers && item.itemType !== 'container') {
      const preserveContent = item.content || item.category === 'singalong' || item.category === 'readalong';
      return { kind: preserveContent ? 'content_item' : 'item', item };
    }

    let items;
    if (modifiers.playable) {
      items = await this.contentCatalog.resolvePlayables(resolution, compoundId);
      if (items === null) return { kind: 'playable_unsupported' };
    } else {
      const list = await this.contentCatalog.getList(resolution, compoundId);
      items = Array.isArray(list) ? list : (list?.children || []);
    }

    if (this.contentQueryService) {
      const enriched = await this.contentQueryService.enrichWithWatchState(items, source, compoundId);
      items = enriched.map((entry) => ({
        ...entry,
        watchProgress: entry.percent ?? null,
        watchSeconds: entry.playhead ?? null,
        watchedDate: entry.lastPlayed ?? null,
      }));
    }

    const fixedOrder = items.some((entry) => entry.metadata?.fixedOrder);
    if (modifiers.shuffle && !fixedOrder) items = shuffle(items, this.random);
    if (modifiers.recent_on_top && !fixedOrder) {
      const memory = this.menuMemory.getAll();
      items = [...items].sort((left, right) => {
        const leftKey = menuKey(left);
        const rightKey = menuKey(right);
        return (rightKey ? memory[rightKey] || 0 : 0) - (leftKey ? memory[leftKey] || 0 : 0);
      });
    }

    const info = modifiers.playable
      ? await this.contentCatalog.getContainerInfo(resolution, compoundId)
      : null;
    const parents = {};
    if (modifiers.playable) {
      for (const entry of items) {
        const parentId = entry.metadata?.parentId;
        if (parentId && !parents[parentId]) {
          parents[parentId] = {
            index: entry.metadata?.parentIndex,
            title: entry.metadata?.parentTitle || 'Parent',
            thumbnail: entry.metadata?.parentThumb || null,
            type: entry.metadata?.parentType,
          };
        }
      }
    }
    return { kind: 'container', source, localId, item, items, info, parents };
  }

  recordMenuSelection(assetId) {
    return this.menuMemory.record(assetId, Math.floor(this.clock() / 1000));
  }
}

export default ItemService;
