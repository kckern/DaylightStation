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

  get source() {
    return 'folder';
  }

  get prefixes() {
    return [{ prefix: 'folder' }];
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

  /**
   * Parse input string to extract source and id
   * Formats: "plex: 123", "list: FolderName", "primary: 2", "media: path/to/file"
   */
  _parseInput(input) {
    if (!input) return null;
    const match = input.match(/^(\w+):\s*(.+?)(?:;.*)?$/);
    if (!match) return null;
    const [, source, value] = match;
    return { source: source.toLowerCase(), id: value.trim() };
  }

  async getList(id) {
    const folderName = id.replace('folder:', '');
    const watchlist = this._loadWatchlist();

    // Filter items belonging to this folder
    const folderItems = watchlist.filter(item => item.folder === folderName);
    if (folderItems.length === 0) return null;

    const children = folderItems.map(item => {
      const parsed = this._parseInput(item.input);
      if (!parsed) return null;

      // Map source names to content source types
      const sourceMap = {
        plex: 'plex',
        list: 'folder',
        primary: 'local-content',
        hymn: 'local-content',
        scripture: 'local-content',
        talk: 'local-content',
        media: 'filesystem'
      };

      const contentSource = sourceMap[parsed.source] || parsed.source;
      const compoundId = contentSource === 'folder'
        ? parsed.id
        : `${contentSource}:${parsed.id}`;

      return new Item({
        id: compoundId,
        source: contentSource,
        title: item.label || parsed.id,
        type: item.action === 'Queue' ? 'queue' : 'list',
        thumbnail: item.image,
        metadata: {
          shuffle: item.shuffle,
          continuous: item.continuous,
          playable: item.playable,
          uid: item.uid
        }
      });
    }).filter(Boolean);

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
    return new ListableItem({
      id,
      source: 'folder',
      title: list.title,
      itemType: 'container',
      childCount: list.children.length
    });
  }

  async resolvePlayables(id) {
    const list = await this.getList(id);
    if (!list || !this.registry) return [];
    const playables = [];
    for (const child of list.children) {
      const resolved = this.registry.resolve(child.id);
      if (resolved?.adapter?.resolvePlayables) {
        const childPlayables = await resolved.adapter.resolvePlayables(child.id);
        playables.push(...childPlayables);
      }
    }
    return playables;
  }
}
