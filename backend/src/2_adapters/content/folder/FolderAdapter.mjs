// backend/src/2_adapters/content/folder/FolderAdapter.mjs
import fs from 'fs';
import yaml from 'js-yaml';
import { ListableItem } from '../../../1_domains/content/capabilities/Listable.mjs';
import { Item } from '../../../1_domains/content/entities/Item.mjs';

/**
 * Adapter for custom folders/watchlists containing mixed-source items
 */
export class FolderAdapter {
  constructor(config) {
    if (!config.watchlistPath) throw new Error('FolderAdapter requires watchlistPath');
    this.watchlistPath = config.watchlistPath;
    this.registry = config.registry || null;
    this._watchlistCache = null;
  }

  get name() {
    return 'folder';
  }

  get prefixes() {
    return ['folder'];
  }

  canResolve(id) {
    return id.startsWith('folder:');
  }

  getStoragePath(id) {
    const folderName = id.replace('folder:', '');
    return `folder_${folderName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  _loadWatchlist() {
    if (this._watchlistCache) return this._watchlistCache;
    try {
      if (!fs.existsSync(this.watchlistPath)) return [];
      const content = fs.readFileSync(this.watchlistPath, 'utf8');
      this._watchlistCache = yaml.load(content) || [];
      return this._watchlistCache;
    } catch (err) {
      return [];
    }
  }

  async getList(id) {
    const folderName = id.replace('folder:', '');
    const watchlist = this._loadWatchlist();
    const folder = watchlist.find(f => f.folder === folderName);
    if (!folder) return null;

    const children = (folder.items || []).map(item => {
      const compoundId = item.source === 'local-content'
        ? item.id
        : `${item.source}:${item.id}`;
      return new Item({
        id: compoundId,
        source: item.source,
        title: item.title || item.id,
        type: 'reference'
      });
    });

    return new ListableItem({
      id,
      source: 'folder',
      title: folderName,
      itemType: 'container',
      children
    });
  }

  async getItem(id) {
    const list = await this.getList(id);
    if (!list) return null;
    return new Item({
      id,
      source: 'folder',
      title: list.title,
      type: 'folder',
      metadata: { itemCount: list.children.length }
    });
  }

  async resolvePlayables(id) {
    const list = await this.getList(id);
    if (!list || !this.registry) return [];
    const playables = [];
    for (const child of list.children) {
      const adapter = this.registry.getAdapter(child.id);
      if (adapter && adapter.resolvePlayables) {
        const resolved = await adapter.resolvePlayables(child.id);
        playables.push(...resolved);
      }
    }
    return playables;
  }
}
