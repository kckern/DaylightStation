import { ContentCategory } from '../domain/value-objects/ContentCategory.mjs';
import { listItemParts, listItemThumbnail, makeListItem } from '../domain/utils/listItemProjection.mjs';

export class ListMenuProjector {
  constructor({ registry = null, resourcePresenter, logger, artworkForUid } = {}) {
    Object.assign(this, { registry, resourcePresenter, logger, artworkForUid });
  }
  async project({ list, sourceId, order = 'authored', actionDecorator }) {
    if (!['authored', 'existing'].includes(order)) throw new TypeError('Invalid list order');
    const listPrefix = sourceId.includes(':') ? sourceId.split(':')[0] : 'menu';
    const items = [];
    for (const sourceItem of (list.sections || []).flatMap(section => section.items || [])) {
      if (sourceItem.active === false) continue;
      // The callback receives copies so it cannot mutate the caller's persisted value.
      const item = structuredClone(sourceItem);
      let resolved;
      if (item.android) {
        resolved = { id: `android:${item.android.package}/${item.android.activity}`, title: item.title,
          thumbnail: item.image, itemType: 'leaf', metadata: { uid: item.uid }, android: item.android };
      } else {
        const p = listItemParts(item, list.metadata);
        const actions = Object.fromEntries(Object.entries({ play: p.playAction, queue: p.queueAction, list: p.listAction, open: p.openAction, display: p.displayAction }).map(([key, action]) => [key, Object.keys(action).length ? action : undefined]));
        let thumbnail = await listItemThumbnail(item, p.contentId, this);
        if (thumbnail && this.resourcePresenter) thumbnail = await this.resourcePresenter(thumbnail);
        resolved = makeListItem({ item, listPrefix, ...p, compoundId: `${p.source}:${p.localId}`, thumbnail,
          metadata: { category: ContentCategory.LIST, listType: listPrefix, days: item.days, applySchedule: item.applySchedule, fixedOrder: item.fixed_order || false, uid: item.uid }, actions });
      }
      if (actionDecorator) {
        const candidate = Object.assign(Object.create(Object.getPrototypeOf(resolved)), resolved, {
          actions: resolved.actions ? structuredClone(resolved.actions) : resolved.actions,
          metadata: resolved.metadata ? structuredClone(resolved.metadata) : resolved.metadata,
        });
        const decorated = await actionDecorator({ item: structuredClone(item), resolved: candidate });
        if (decorated && resolved.actions) resolved.actions = decorated.actions;
      }
      items.push(resolved);
    }
    return { id: sourceId, title: list.title || sourceId, image: list.image || null, items };
  }
}
