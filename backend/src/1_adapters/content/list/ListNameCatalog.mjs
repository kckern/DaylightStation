import { IListNameCatalog } from '#apps/content/ports/IListNameCatalog.mjs';

export class ListNameCatalog extends IListNameCatalog {
  constructor({ listAdapter }) { super(); this.listAdapter = listAdapter; }
  listNames(type) { return this.listAdapter?._getAllListNames?.(type) || []; }
}
