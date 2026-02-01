// backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
import { ImmichClient } from './ImmichClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Immich content source adapter.
 * Implements IContentSource + IMediaSearchable for accessing Immich gallery.
 */
export class ImmichAdapter {
  #client;
  #proxyPath;
  #peopleCache;
  #peopleCacheTime;

  /**
   * @param {Object} config
   * @param {string} config.host - Immich server URL
   * @param {string} config.apiKey - Immich API key
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/immich')
   * @param {number} [config.slideDuration] - Default slide duration in seconds (default: 10)
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('ImmichAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('ImmichAdapter requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }

    this.#client = new ImmichClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/immich';
    this.slideDuration = config.slideDuration || 10;
    this.#peopleCache = null;
    this.#peopleCacheTime = 0;
  }

  /** @returns {string} */
  get source() {
    return 'immich';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'immich' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^immich:/, '');
  }

  /**
   * Build thumbnail URL
   * @param {string} assetId
   * @returns {string}
   */
  #thumbnailUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/thumbnail`;
  }

  /**
   * Build video playback URL
   * @param {string} assetId
   * @returns {string}
   */
  #videoUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/video/playback`;
  }

  /**
   * Build original image URL
   * @param {string} assetId
   * @returns {string}
   */
  #originalUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/original`;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (immich:abc-123)
   * @returns {Promise<ListableItem|PlayableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Check if it's an album reference
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        return this.#toAlbumListable(album);
      }

      const asset = await this.#client.getAsset(localId);
      if (!asset) return null;

      if (asset.type === 'VIDEO') {
        return this.#toPlayableItem(asset);
      }
      return this.#toListableItem(asset);
    } catch (err) {
      console.error('[ImmichAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string|Object} input - ID string or query object with 'from' field
   * @returns {Promise<ListableItem[]>}
   */
  async getList(input) {
    try {
      // Normalize input - support both string ID and query object
      const localId = typeof input === 'string'
        ? this.#stripPrefix(input)
        : this.#stripPrefix(input?.from || '');

      // Empty = list all albums
      if (!localId) {
        const albums = await this.#client.getAlbums();
        return albums.map(album => this.#toAlbumListable(album));
      }

      // List all people (with statistics for photo counts)
      if (localId === 'person:') {
        const people = await this.#client.getPeople({ withStatistics: true });
        return people.map(person => this.#toPersonListable(person));
      }

      // Person's photos
      if (localId.startsWith('person:')) {
        const personId = localId.replace('person:', '');
        const assets = await this.#client.getPersonAssets(personId);
        return assets.map(asset =>
          asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
        );
      }

      // Album contents
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        return (album.assets || []).map(asset =>
          asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
        );
      }

      return [];
    } catch (err) {
      console.error('[ImmichAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items (for slideshows)
   * @param {string} id - Album or asset ID
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Single asset
      if (!localId.startsWith('album:')) {
        const asset = await this.#client.getAsset(localId);
        if (!asset) return [];
        return [this.#toPlayableItem(asset, true)];
      }

      // Album = all assets as slideshow
      const albumId = localId.replace('album:', '');
      const album = await this.#client.getAlbum(albumId);
      return (album.assets || []).map(asset => this.#toPlayableItem(asset, true));
    } catch (err) {
      console.error('[ImmichAdapter] resolvePlayables error:', err.message);
      return [];
    }
  }

  /**
   * Get DisplayableItem for static display
   * @param {string} id
   * @returns {Promise<DisplayableItem|null>}
   */
  async getViewable(id) {
    try {
      const localId = this.#stripPrefix(id);
      const asset = await this.#client.getAsset(localId);
      if (!asset) return null;

      return new DisplayableItem({
        id: `immich:${asset.id}`,
        source: 'immich',
        title: asset.originalFileName,
        imageUrl: this.#originalUrl(asset.id),
        thumbnail: this.#thumbnailUrl(asset.id),
        width: asset.width,
        height: asset.height,
        mimeType: asset.originalMimeType,
        metadata: {
          exif: asset.exifInfo,
          people: asset.people?.map(p => p.name) || [],
          capturedAt: asset.exifInfo?.dateTimeOriginal,
          favorite: asset.isFavorite
        }
      });
    } catch (err) {
      console.error('[ImmichAdapter] getViewable error:', err.message);
      return null;
    }
  }

  /**
   * Search for media items
   * @param {Object} query - MediaSearchQuery
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    try {
      const immichQuery = await this.#buildImmichQuery(query);
      const result = await this.#client.searchMetadata(immichQuery);

      const items = (result.items || []).map(asset =>
        asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
      );

      return { items, total: result.total || items.length };
    } catch (err) {
      console.error('[ImmichAdapter] search error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Get search capabilities for ContentQueryService.
   * Returns structured capability info for query orchestration.
   * @returns {{canonical: string[], specific: string[]}}
   */
  getSearchCapabilities() {
    return {
      canonical: ['text', 'person', 'time', 'mediaType', 'favorites'],
      specific: ['location', 'tags']
    };
  }

  /**
   * Get canonical → adapter-specific query key mappings.
   * Used by ContentQueryService to translate queries.
   * @returns {Object}
   */
  getQueryMappings() {
    return {
      person: 'personIds',
      time: { from: 'takenAfter', to: 'takenBefore' },
      text: 'query'
    };
  }

  /**
   * Get container alias → internal path mappings.
   * @returns {Object}
   */
  getContainerAliases() {
    return {
      playlists: 'album:',
      albums: 'album:',
      people: 'person:',
      cameras: 'camera:'
    };
  }

  /**
   * Get list of root containers for browsing.
   * @returns {string[]}
   */
  getRootContainers() {
    return ['albums', 'people', 'cameras'];
  }

  /**
   * Get storage path for progress persistence
   * @returns {Promise<string>}
   */
  async getStoragePath() {
    return 'immich';
  }

  /**
   * Build Immich search query from MediaSearchQuery
   * @param {Object} query
   * @returns {Promise<Object>}
   */
  async #buildImmichQuery(query) {
    const immichQuery = {};

    if (query.text) {
      immichQuery.query = query.text;
    }

    if (query.mediaType) {
      immichQuery.type = query.mediaType.toUpperCase();
    }

    if (query.dateFrom) {
      immichQuery.takenAfter = query.dateFrom;
    }

    if (query.dateTo) {
      immichQuery.takenBefore = query.dateTo;
    }

    if (query.location) {
      immichQuery.city = query.location;
    }

    if (query.favorites) {
      immichQuery.isFavorite = true;
    }

    if (query.take) {
      immichQuery.take = query.take;
    }

    if (query.skip) {
      immichQuery.skip = query.skip;
    }

    // Resolve people names to IDs
    if (query.people?.length > 0) {
      const personIds = await this.#resolvePersonIds(query.people);
      if (personIds.length > 0) {
        immichQuery.personIds = personIds;
      }
    }

    return immichQuery;
  }

  /**
   * Resolve person names to Immich person IDs
   * @param {string[]} names
   * @returns {Promise<string[]>}
   */
  async #resolvePersonIds(names) {
    // Cache people for 5 minutes
    const now = Date.now();
    if (!this.#peopleCache || now - this.#peopleCacheTime > 300000) {
      this.#peopleCache = await this.#client.getPeople();
      this.#peopleCacheTime = now;
    }

    const lowerNames = names.map(n => n.toLowerCase());
    return this.#peopleCache
      .filter(p => lowerNames.includes(p.name?.toLowerCase()))
      .map(p => p.id);
  }

  /**
   * Convert album to ListableItem
   * @param {Object} album
   * @returns {ListableItem}
   */
  #toAlbumListable(album) {
    return new ListableItem({
      id: `immich:album:${album.id}`,
      source: 'immich',
      title: album.albumName,
      itemType: 'container',
      childCount: album.assetCount || album.assets?.length || 0,
      thumbnail: album.albumThumbnailAssetId
        ? this.#thumbnailUrl(album.albumThumbnailAssetId)
        : null,
      description: album.description || null,
      metadata: {
        type: 'album',
        shared: album.shared || false
      }
    });
  }

  /**
   * Convert person to ListableItem (for person selection)
   * @param {Object} person
   * @returns {ListableItem}
   */
  #toPersonListable(person) {
    return new ListableItem({
      id: `immich:person:${person.id}`,
      source: 'immich',
      title: person.name || 'Unknown',
      itemType: 'container',
      childCount: person.assetCount || 0,
      thumbnail: person.thumbnailPath
        ? `${this.#proxyPath}${person.thumbnailPath}`
        : null,
      metadata: {
        type: 'person',
        birthDate: person.birthDate,
        isHidden: person.isHidden || false,
        isFavorite: person.isFavorite || false,
        assetCount: person.assetCount || 0
      }
    });
  }

  /**
   * Convert asset to ListableItem (for images in browse view)
   * @param {Object} asset
   * @returns {ListableItem}
   */
  #toListableItem(asset) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(asset.id),
      imageUrl: this.#originalUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase() || 'image',
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite
      }
    });
  }

  /**
   * Convert asset to PlayableItem (for videos or slideshow images)
   * @param {Object} asset
   * @param {boolean} [forSlideshow=false] - If true, images get synthetic duration
   * @returns {PlayableItem}
   */
  #toPlayableItem(asset, forSlideshow = false) {
    const isVideo = asset.type === 'VIDEO';
    const duration = isVideo
      ? this.#client.parseDuration(asset.duration)
      : (forSlideshow ? this.slideDuration : null);

    return new PlayableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      mediaType: isVideo ? 'video' : 'image',
      mediaUrl: isVideo ? this.#videoUrl(asset.id) : this.#originalUrl(asset.id),
      duration,
      resumable: isVideo,
      thumbnail: this.#thumbnailUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase(),
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite,
        people: asset.people?.map(p => p.name) || []
      }
    });
  }
}

export default ImmichAdapter;
