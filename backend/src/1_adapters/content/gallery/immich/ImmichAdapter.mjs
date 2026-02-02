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
   * @param {string} id - Compound ID (immich:abc-123, immich:person:abc-123, immich:album:abc-123)
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

      // Check if it's a person reference
      if (localId.startsWith('person:')) {
        const personId = localId.replace('person:', '');
        const people = await this.#client.getPeople({ withStatistics: true });
        const person = people.find(p => p.id === personId);
        if (!person) return null;
        return this.#toPersonListable(person);
      }

      // Check if it's a tag reference
      if (localId.startsWith('tag:')) {
        const tagId = localId.replace('tag:', '');
        const tags = await this.#client.getTags();
        const tag = tags.find(t => t.id === tagId);
        if (!tag) return null;
        return this.#toTagListable(tag);
      }

      // Try as asset ID first
      try {
        const asset = await this.#client.getAsset(localId);
        if (asset) {
          if (asset.type === 'VIDEO') {
            return this.#toPlayableItem(asset);
          }
          return this.#toListableItem(asset);
        }
      } catch {
        // Asset lookup failed - continue to try other lookups
      }

      // If asset lookup failed, try as person ID (for bare UUIDs without person: prefix)
      try {
        const people = await this.#client.getPeople({ withStatistics: true });
        const person = people.find(p => p.id === localId);
        if (person) {
          return this.#toPersonListable(person);
        }
      } catch {
        // Ignore person lookup errors
      }

      // Try as album ID
      try {
        const album = await this.#client.getAlbum(localId);
        if (album) {
          return this.#toAlbumListable(album);
        }
      } catch {
        // Ignore album lookup errors
      }

      return null;
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

      // List all tags
      if (localId === 'tag:' || localId === 'tags') {
        const tags = await this.#client.getTags();
        return tags.map(tag => this.#toTagListable(tag));
      }

      // Tag's photos
      if (localId.startsWith('tag:')) {
        const tagId = localId.replace('tag:', '');
        const tags = await this.#client.getTags();
        const tag = tags.find(t => t.id === tagId);
        const tagName = tag?.name || 'Unknown';

        const assets = await this.#client.getTagAssets(tagId);
        const context = {
          parentTitle: tagName,
          parentId: `immich:tag:${tagId}`
        };
        return assets.map(asset =>
          asset.type === 'VIDEO'
            ? this.#toPlayableItem(asset, false, context)
            : this.#toListableItem(asset, context)
        );
      }

      // Person's photos
      if (localId.startsWith('person:')) {
        const personId = localId.replace('person:', '');
        // Fetch person info for context
        const people = await this.#client.getPeople({ withStatistics: true });
        const person = people.find(p => p.id === personId);
        const personName = person?.name || 'Unknown';

        const assets = await this.#client.getPersonAssets(personId);
        const context = {
          parentTitle: personName,
          parentId: `immich:person:${personId}`
        };
        return assets.map(asset =>
          asset.type === 'VIDEO'
            ? this.#toPlayableItem(asset, false, context)
            : this.#toListableItem(asset, context)
        );
      }

      // Album contents
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        const context = {
          parentTitle: album.albumName,
          parentId: `immich:album:${albumId}`
        };
        return (album.assets || []).map(asset =>
          asset.type === 'VIDEO'
            ? this.#toPlayableItem(asset, false, context)
            : this.#toListableItem(asset, context)
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
   * @param {string} id - Album, person, or asset ID
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Person's photos as slideshow
      if (localId.startsWith('person:')) {
        const personId = localId.replace('person:', '');
        const people = await this.#client.getPeople({ withStatistics: true });
        const person = people.find(p => p.id === personId);
        const personName = person?.name || 'Unknown';

        const assets = await this.#client.getPersonAssets(personId);
        const context = {
          parentTitle: personName,
          parentId: `immich:person:${personId}`
        };
        return assets.map(asset => this.#toPlayableItem(asset, true, context));
      }

      // Album = all assets as slideshow
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        const context = {
          parentTitle: album.albumName,
          parentId: `immich:album:${albumId}`
        };
        return (album.assets || []).map(asset => this.#toPlayableItem(asset, true, context));
      }

      // Single asset
      const asset = await this.#client.getAsset(localId);
      if (!asset) return [];
      return [this.#toPlayableItem(asset, true)];
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
   * Search for media items, people, tags, and albums
   * @param {Object} query - MediaSearchQuery
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    try {
      // Use query.text or query.query (after translation)
      const searchText = query.text || query.query;

      // Check for special search patterns
      const mapMatch = searchText?.match(/^map#([\d.-]+)\/([\d.-]+)\/([\d.-]+)$/);
      if (mapMatch) {
        // Geo search: map#zoom/lat/lon
        return this.#searchByMap(parseFloat(mapMatch[2]), parseFloat(mapMatch[3]), parseFloat(mapMatch[1]));
      }

      // Run all searches in parallel
      const [assetResult, matchingPeople, matchingTags, matchingAlbums] = await Promise.all([
        this.#searchAssets(query),
        searchText ? this.#searchPeople(searchText) : Promise.resolve([]),
        searchText ? this.#searchTags(searchText) : Promise.resolve([]),
        searchText ? this.#searchAlbums(searchText) : Promise.resolve([])
      ]);

      // Combine results - containers first (people, tags, albums), then assets
      const items = [
        ...matchingPeople,
        ...matchingTags,
        ...matchingAlbums,
        ...assetResult.items
      ];
      const total = items.length;

      return { items, total };
    } catch (err) {
      console.error('[ImmichAdapter] search error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Search for assets by query
   * @param {Object} query
   * @returns {Promise<{items: Array}>}
   */
  async #searchAssets(query) {
    const immichQuery = await this.#buildImmichQuery(query);
    const result = await this.#client.searchMetadata(immichQuery);

    const items = (result.items || []).map(asset =>
      asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
    );

    return { items };
  }

  /**
   * Search for people by name
   * @param {string} text - Search text
   * @returns {Promise<ListableItem[]>}
   */
  async #searchPeople(text) {
    try {
      const searchLower = text.toLowerCase();
      const people = await this.#client.getPeople({ withStatistics: true });

      // Find people whose names contain the search text
      const matching = people.filter(p =>
        p.name && p.name.toLowerCase().includes(searchLower)
      );

      // Sort by relevance - exact match first, then starts with, then contains
      matching.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aExact = aName === searchLower;
        const bExact = bName === searchLower;
        const aStarts = aName.startsWith(searchLower);
        const bStarts = bName.startsWith(searchLower);

        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        // Secondary sort by asset count (more photos = higher)
        return (b.assetCount || 0) - (a.assetCount || 0);
      });

      return matching.map(person => this.#toPersonListable(person));
    } catch (err) {
      console.error('[ImmichAdapter] searchPeople error:', err.message);
      return [];
    }
  }

  /**
   * Search for tags by name
   * @param {string} text - Search text
   * @returns {Promise<ListableItem[]>}
   */
  async #searchTags(text) {
    try {
      const searchLower = text.toLowerCase();
      const tags = await this.#client.getTags();

      // Find tags whose names contain the search text
      const matching = tags.filter(t =>
        t.name && t.name.toLowerCase().includes(searchLower)
      );

      // Sort by relevance
      matching.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName === searchLower) return -1;
        if (bName === searchLower) return 1;
        if (aName.startsWith(searchLower)) return -1;
        if (bName.startsWith(searchLower)) return 1;
        return 0;
      });

      return matching.map(tag => this.#toTagListable(tag));
    } catch (err) {
      console.error('[ImmichAdapter] searchTags error:', err.message);
      return [];
    }
  }

  /**
   * Search for albums by name
   * @param {string} text - Search text
   * @returns {Promise<ListableItem[]>}
   */
  async #searchAlbums(text) {
    try {
      const searchLower = text.toLowerCase();
      const albums = await this.#client.getAlbums();

      // Find albums whose names contain the search text
      const matching = albums.filter(a =>
        a.albumName && a.albumName.toLowerCase().includes(searchLower)
      );

      // Sort by relevance
      matching.sort((a, b) => {
        const aName = a.albumName.toLowerCase();
        const bName = b.albumName.toLowerCase();
        if (aName === searchLower) return -1;
        if (bName === searchLower) return 1;
        if (aName.startsWith(searchLower)) return -1;
        if (bName.startsWith(searchLower)) return 1;
        return (b.assetCount || 0) - (a.assetCount || 0);
      });

      return matching.map(album => this.#toAlbumListable(album));
    } catch (err) {
      console.error('[ImmichAdapter] searchAlbums error:', err.message);
      return [];
    }
  }

  /**
   * Search by map coordinates
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} zoom - Zoom level (higher = smaller area)
   * @returns {Promise<{items: Array, total: number}>}
   */
  async #searchByMap(lat, lon, zoom) {
    try {
      // Convert zoom to approximate radius (higher zoom = smaller radius)
      const radius = Math.max(0.01, 10 / Math.pow(2, zoom - 10));

      const assets = await this.#client.searchByLocation({ lat, lon, radius });

      const items = assets.map(asset =>
        asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
      );

      return { items, total: items.length };
    } catch (err) {
      console.error('[ImmichAdapter] searchByMap error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Convert tag to ListableItem
   * @param {Object} tag
   * @returns {ListableItem}
   */
  #toTagListable(tag) {
    return new ListableItem({
      id: `immich:tag:${tag.id}`,
      source: 'immich',
      title: tag.name,
      itemType: 'container',
      childCount: tag.assetCount || 0,
      thumbnail: null, // Tags don't have thumbnails
      metadata: {
        type: 'tag',
        librarySectionTitle: 'Immich',
        parentTitle: 'Tag',
        childCount: tag.assetCount || 0,
        color: tag.color || null
      }
    });
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
      tags: 'tag:',
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
    const assetCount = album.assetCount || album.assets?.length || 0;
    return new ListableItem({
      id: `immich:album:${album.id}`,
      source: 'immich',
      title: album.albumName,
      itemType: 'container',
      childCount: assetCount,
      thumbnail: album.albumThumbnailAssetId
        ? this.#thumbnailUrl(album.albumThumbnailAssetId)
        : null,
      description: album.description || null,
      metadata: {
        type: 'album',
        // Parent info - Albums is a root concept in Immich
        librarySectionTitle: 'Immich',
        parentTitle: 'Albums',
        // Item counts
        childCount: assetCount,
        leafCount: assetCount,
        // Album-specific
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
    const assetCount = person.assetCount || 0;
    return new ListableItem({
      id: `immich:person:${person.id}`,
      source: 'immich',
      title: person.name || 'Unknown',
      itemType: 'container',
      childCount: assetCount,
      // Use API endpoint for person thumbnails (not internal file path)
      thumbnail: `${this.#proxyPath}/api/people/${person.id}/thumbnail`,
      metadata: {
        type: 'person',
        // Parent info - Person is a root concept in Immich
        librarySectionTitle: 'Immich',
        parentTitle: 'Person',
        // Item counts for display
        childCount: assetCount,
        leafCount: assetCount,
        // Person-specific fields
        birthDate: person.birthDate,
        isHidden: person.isHidden || false,
        isFavorite: person.isFavorite || false,
        assetCount: assetCount
      }
    });
  }

  /**
   * Convert asset to ListableItem (for images in browse view)
   * @param {Object} asset
   * @param {Object} [context] - Optional context for parent info
   * @param {string} [context.parentTitle] - Parent container name
   * @param {string} [context.parentId] - Parent container ID
   * @returns {ListableItem}
   */
  #toListableItem(asset, context = {}) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(asset.id),
      imageUrl: this.#originalUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase() || 'image',
        // Library/parent info
        librarySectionTitle: 'Immich',
        parentTitle: context.parentTitle || null,
        parentId: context.parentId || null,
        // Asset details
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
   * @param {Object} [context] - Optional context for parent info
   * @param {string} [context.parentTitle] - Parent container name
   * @param {string} [context.parentId] - Parent container ID
   * @returns {PlayableItem}
   */
  #toPlayableItem(asset, forSlideshow = false, context = {}) {
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
        // Library/parent info
        librarySectionTitle: 'Immich',
        parentTitle: context.parentTitle || null,
        parentId: context.parentId || null,
        // Asset details
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
