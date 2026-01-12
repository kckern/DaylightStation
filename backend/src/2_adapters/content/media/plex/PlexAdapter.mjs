// backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
import { ListableItem } from '../../../../1_domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '../../../../1_domains/content/capabilities/Playable.mjs';
import { PlexClient } from './PlexClient.mjs';

/**
 * Plex content source adapter.
 * Implements IContentSource interface for accessing Plex Media Server content.
 */
export class PlexAdapter {
  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} [config.token] - Plex auth token
   */
  constructor(config) {
    if (!config.host) {
      throw new Error('PlexAdapter requires host');
    }
    this.client = new PlexClient(config);
    this.host = config.host.replace(/\/$/, '');
  }

  /**
   * Source identifier for this adapter
   * @returns {string}
   */
  get source() {
    return 'plex';
  }

  /**
   * URL prefixes this adapter handles
   * @returns {Array<{prefix: string}>}
   */
  get prefixes() {
    return [{ prefix: 'plex' }];
  }

  /**
   * Get a single item by ID
   * @param {string} id - Compound ID (plex:660440) or local ID
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    try {
      // Strip source prefix if present
      const localId = id.replace(/^plex:/, '');

      // If ID is a numeric rating key, fetch metadata directly
      if (/^\d+$/.test(localId)) {
        const data = await this.client.getMetadata(localId);
        const item = data.MediaContainer?.Metadata?.[0];
        if (!item) return null;
        return this._toPlayableItem(item);
      }

      // Otherwise treat as container path
      const data = await this.client.getContainer(`/${localId}`);
      const container = data.MediaContainer;
      if (!container) return null;

      return new ListableItem({
        id: `plex:${localId}`,
        source: 'plex',
        title: container.title1 || container.title || localId,
        itemType: 'container',
        childCount: container.size || 0,
        thumbnail: container.thumb ? `${this.host}${container.thumb}` : null
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get list of items in a container
   * @param {string} id - Container path or rating key (empty for library sections)
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      // Strip source prefix if present
      const localId = id?.replace(/^plex:/, '') || '';

      // Determine the correct path
      let path;
      if (!localId) {
        // Empty - list all library sections
        path = '/library/sections';
      } else if (/^\d+$/.test(localId)) {
        // Numeric ID = rating key - get children
        path = `/library/metadata/${localId}/children`;
      } else {
        // Path-based (e.g., library/sections/1/all)
        path = `/${localId}`;
      }

      const data = await this.client.getContainer(path);
      const container = data.MediaContainer;
      if (!container) return [];

      const items = container.Metadata || container.Directory || [];
      return items.map(item => this._toListableItem(item));
    } catch (err) {
      return [];
    }
  }

  /**
   * Resolve a container to its playable items (recursive)
   * @param {string} id - Container path or rating key
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      // Strip source prefix if present
      const localId = id?.replace(/^plex:/, '') || '';

      // If ID is a numeric rating key, check if directly playable or a container
      if (/^\d+$/.test(localId)) {
        const item = await this.getItem(localId);
        if (item?.mediaUrl) {
          // Directly playable (movie, episode, track)
          return [item];
        }
        // It's a container - get its children
        const children = await this.getList(localId);
        const playables = [];
        for (const child of children) {
          const childId = child.id.replace('plex:', '');
          const resolved = await this.resolvePlayables(childId);
          playables.push(...resolved);
        }
        return playables;
      }

      // Otherwise get list and recurse
      const list = await this.getList(localId);
      const playables = [];

      for (const item of list) {
        if (item.itemType === 'leaf') {
          const ratingKey = item.id.replace('plex:', '');
          const playable = await this.getItem(ratingKey);
          if (playable?.mediaUrl) playables.push(playable);
        } else if (item.itemType === 'container') {
          const childId = item.id.replace('plex:', '');
          const children = await this.resolvePlayables(childId);
          playables.push(...children);
        }
      }

      return playables;
    } catch (err) {
      return [];
    }
  }

  /**
   * Convert Plex metadata to ListableItem
   * @param {Object} item - Plex metadata object
   * @returns {ListableItem}
   * @private
   */
  _toListableItem(item) {
    const isContainer = ['show', 'season', 'artist', 'album'].includes(item.type) ||
                       !!item.key?.includes('/children');
    const id = item.ratingKey || item.key?.replace(/^\//, '').replace(/\/children$/, '');

    return new ListableItem({
      id: `plex:${id}`,
      source: 'plex',
      title: item.title,
      itemType: isContainer ? 'container' : 'leaf',
      childCount: item.leafCount || item.childCount || 0,
      thumbnail: item.thumb ? `${this.host}${item.thumb}` : null,
      metadata: {
        type: item.type,
        year: item.year
      }
    });
  }

  /**
   * Convert Plex metadata to PlayableItem (or ListableItem for containers)
   * @param {Object} item - Plex metadata object
   * @returns {PlayableItem|ListableItem}
   * @private
   */
  _toPlayableItem(item) {
    const isVideo = ['movie', 'episode', 'clip'].includes(item.type);
    const isAudio = ['track'].includes(item.type);

    // Non-playable types return as containers
    if (!isVideo && !isAudio) {
      return new ListableItem({
        id: `plex:${item.ratingKey}`,
        source: 'plex',
        title: item.title,
        itemType: 'container',
        childCount: item.leafCount || 0,
        thumbnail: item.thumb ? `${this.host}${item.thumb}` : null
      });
    }

    return new PlayableItem({
      id: `plex:${item.ratingKey}`,
      source: 'plex',
      title: item.title,
      mediaType: isVideo ? 'video' : 'audio',
      mediaUrl: `/proxy/plex/stream/${item.ratingKey}`,
      duration: item.duration ? Math.floor(item.duration / 1000) : null,
      resumable: isVideo,
      resumePosition: item.viewOffset ? Math.floor(item.viewOffset / 1000) : null,
      thumbnail: item.thumb ? `${this.host}${item.thumb}` : null,
      metadata: {
        type: item.type,
        year: item.year,
        grandparentTitle: item.grandparentTitle
      }
    });
  }

  /**
   * Get storage path for progress persistence
   * @param {string} id - Item ID
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'plex';
  }
}
