// backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
import { PlexClient } from './PlexClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Plex content source adapter.
 * Implements IContentSource interface for accessing Plex Media Server content.
 */
export class PlexAdapter {
  #httpClient;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} [config.token] - Plex auth token
   * @param {string} [config.protocol] - Streaming protocol (default: 'dash')
   * @param {string} [config.platform] - Client platform (default: 'Chrome')
   * @param {string} [config.proxyPath] - Proxy path for media URLs (default: '/api/v1/proxy/plex')
   * @param {Object} [config.mediaProgressMemory] - WatchStore instance for viewing history persistence
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('PlexAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('PlexAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }
    this.#httpClient = deps.httpClient;
    this.client = new PlexClient(config, { httpClient: deps.httpClient });
    this.host = config.host.replace(/\/$/, '');
    this.token = config.token || '';
    this.protocol = config.protocol || 'dash';
    this.platform = config.platform || 'Chrome';
    this.proxyPath = config.proxyPath || '/api/v1/proxy/plex';
    this.mediaProgressMemory = config.mediaProgressMemory || null;
    this.mediaKeyResolver = config.mediaKeyResolver || null;
  }

  /**
   * Extract labels from Plex Label array, normalizing to lowercase strings
   * @param {Array} labelArray - Plex Label array (can be strings or {tag: string} objects)
   * @returns {string[]} - Normalized lowercase label strings
   * @private
   */
  _extractLabels(labelArray) {
    if (!Array.isArray(labelArray)) return [];
    const labels = [];
    for (const label of labelArray) {
      if (typeof label === 'string') labels.push(label.toLowerCase());
      else if (label?.tag) labels.push(label.tag.toLowerCase());
    }
    return labels;
  }

  /**
   * Map Plex type to ContentCategory
   * @param {string} type - Plex item type
   * @returns {string} ContentCategory value
   */
  #mapTypeToCategory(type) {
    const mapping = {
      'playlist': ContentCategory.CURATED,
      'collection': ContentCategory.CURATED,
      'artist': ContentCategory.CREATOR,
      'show': ContentCategory.SERIES,
      'movie': ContentCategory.WORK,
      'album': ContentCategory.CONTAINER,
      'season': ContentCategory.CONTAINER,
      'episode': ContentCategory.EPISODE,
      'track': ContentCategory.TRACK,
      'clip': ContentCategory.MEDIA,
      'photo': ContentCategory.MEDIA
    };
    return mapping[type] || ContentCategory.MEDIA;
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
   * Get raw Plex metadata for a rating key
   * @param {string} ratingKey - Plex rating key
   * @returns {Promise<Object|null>} Raw Plex metadata
   */
  async getMetadata(ratingKey) {
    try {
      const metadata = await this.client.getMetadata(ratingKey);
      return metadata || null;
    } catch (err) {
      console.error('[PlexAdapter] getMetadata error:', err.message);
      return null;
    }
  }

  /**
   * Get thumbnail URLs from a Plex rating key
   * Migrated from: plex.mjs:432-438
   * @param {string} ratingKey - Plex rating key
   * @returns {Promise<string[]>} Array of thumbnail URLs [thumb, parentThumb, grandparentThumb]
   */
  async loadImgFromKey(ratingKey) {
    try {
      const metadata = await this.client.getMetadata(ratingKey);
      const item = metadata?.MediaContainer?.Metadata?.[0];
      if (!item) return ['', '', ''];

      const { thumb, parentThumb, grandparentThumb } = item;
      // Legacy returns empty string "" for missing thumbs
      return [thumb, parentThumb, grandparentThumb].map(
        t => t ? `${this.proxyPath}${t}` : ''
      );
    } catch (err) {
      console.error('[PlexAdapter] loadImgFromKey error:', err.message);
      return ['', '', ''];
    }
  }

  /**
   * Get a single item by ID
   * @param {string} id - Compound ID (plex:660440) or local ID
   * @param {Object} [opts] - Options
   * @param {Map} [opts.showLabelCache] - Cache for show labels to avoid redundant API calls in batch operations
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id, opts = {}) {
    try {
      // Strip source prefix if present
      const localId = id.replace(/^plex:/, '');

      // If ID is a numeric rating key, fetch metadata directly
      if (/^\d+$/.test(localId)) {
        const data = await this.client.getMetadata(localId);
        const item = data.MediaContainer?.Metadata?.[0];
        if (!item) return null;

        // For episodes, also fetch show-level labels (governance labels are typically on the show)
        let showLabels = [];
        if (item.type === 'episode' && item.grandparentRatingKey) {
          const showKey = item.grandparentRatingKey;
          const cache = opts.showLabelCache;

          // Check cache first if provided
          if (cache && cache.has(showKey)) {
            showLabels = cache.get(showKey);
          } else {
            try {
              const showData = await this.client.getMetadata(showKey);
              const show = showData?.MediaContainer?.Metadata?.[0];
              showLabels = this._extractLabels(show?.Label);
              // Store in cache if provided
              if (cache) {
                cache.set(showKey, showLabels);
              }
            } catch (err) {
              // Debug log but don't fail - episode can still play without show labels
              if (process.env.NODE_ENV !== 'production') {
                console.debug('[PlexAdapter] Failed to fetch show labels:', err.message);
              }
              // Cache the empty result to avoid retrying failed fetches
              if (cache) {
                cache.set(showKey, []);
              }
            }
          }
        }

        return this._toPlayableItem(item, { showLabels });
      }

      // Otherwise treat as container path
      const data = await this.client.getContainer(`/${localId}`);
      const container = data.MediaContainer;
      if (!container) return null;

      return new ListableItem({
        id: `plex:${localId}`,
        source: 'plex',
        localId,
        title: container.title1 || container.title || localId,
        itemType: 'container',
        childCount: container.size || 0,
        thumbnail: container.thumb ? `${this.proxyPath}${container.thumb}` : null,
        metadata: {
          category: ContentCategory.CONTAINER
        }
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get list of items in a container
   * @param {string|Object} input - Container path/rating key (string) or query object
   * @param {string} [input.from] - Container path when input is object
   * @param {string} [input['plex.libraryName']] - Filter playlists by library name
   * @returns {Promise<ListableItem[]>}
   */
  async getList(input) {
    try {
      // Normalize input - support both string ID and query object
      const localId = typeof input === 'string'
        ? input?.replace(/^plex:/, '') || ''
        : (input?.from?.replace(/^plex:/, '') || '');
      const query = typeof input === 'object' ? input : {};

      // Extract adapter-specific filter params
      const libraryNameFilter = query['plex.libraryName'];

      // Determine the correct path based on item type
      let path;
      if (!localId) {
        // Empty - list all library sections
        path = '/library/sections';
      } else if (/^\d+$/.test(localId)) {
        // Numeric ID - need to check type first
        const metaData = await this.client.getMetadata(localId);
        const meta = metaData?.MediaContainer?.Metadata?.[0];
        const type = meta?.type;

        // Use appropriate path based on type
        if (type === 'collection') {
          path = `/library/collections/${localId}/items`;
        } else if (type === 'playlist') {
          path = `/playlists/${localId}/items`;
        } else {
          // Default: get children (works for shows, seasons, albums, etc.)
          path = `/library/metadata/${localId}/children`;
        }
      } else if (localId === 'playlist:' || localId === 'playlists') {
        // List all playlists
        path = '/playlists/all';
      } else {
        // Path-based (e.g., library/sections/1/all)
        path = `/${localId}`;
      }

      const data = await this.client.getContainer(path);
      const container = data.MediaContainer;
      if (!container) return [];

      let items = container.Metadata || container.Directory || [];

      // Apply library name filter for playlists
      if (libraryNameFilter && (localId === 'playlist:' || localId === 'playlists' || localId.startsWith('playlists'))) {
        items = this._filterPlaylistsByLibraryName(items, libraryNameFilter);
      }

      // For playable item types (episodes, tracks, movies), use full conversion
      // to include duration, episode number, and other playback-relevant metadata
      const playableTypes = ['episode', 'track', 'movie', 'clip'];

      return items.map(item => {
        if (playableTypes.includes(item.type)) {
          return this._toPlayableItem(item);
        }
        return this._toListableItem(item);
      });
    } catch (err) {
      console.error('[PlexAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Filter playlists by library name with fallback matching
   * @param {Object[]} playlists - Raw Plex playlist metadata
   * @param {string} targetName - Library name to match
   * @returns {Object[]} Filtered playlists
   * @private
   */
  _filterPlaylistsByLibraryName(playlists, targetName) {
    const target = targetName.toLowerCase();

    // For "music" library, use playlistType as the primary filter
    // (playlists don't have librarySectionTitle, but playlistType indicates content type)
    if (target === 'music') {
      const audioPlaylists = playlists.filter(p => p.playlistType === 'audio');
      return audioPlaylists;
    }

    // For "video" library, use video playlistType
    if (target === 'video' || target === 'movies' || target === 'tv') {
      const videoPlaylists = playlists.filter(p => p.playlistType === 'video');
      return videoPlaylists;
    }

    // For other library names, try librarySectionTitle matching (fallback)
    let filtered = playlists.filter(p =>
      p.librarySectionTitle?.toLowerCase() === target
    );

    if (filtered.length === 0) {
      filtered = playlists.filter(p =>
        p.librarySectionTitle?.toLowerCase().includes(target)
      );
    }

    return filtered;
  }

  /**
   * Resolve a container to its playable items (recursive)
   * @param {string} id - Container path or rating key
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    // Create a cache for show labels to avoid N+1 queries when processing
    // multiple episodes from the same show
    const showLabelCache = new Map();
    return this._resolvePlayablesWithCache(id, showLabelCache);
  }

  /**
   * Internal recursive resolver with cache support
   * @param {string} id - Container path or rating key
   * @param {Map} showLabelCache - Cache for show labels
   * @returns {Promise<PlayableItem[]>}
   * @private
   */
  async _resolvePlayablesWithCache(id, showLabelCache) {
    try {
      // Strip source prefix if present
      const localId = id?.replace(/^plex:/, '') || '';

      // If ID is a numeric rating key, check if directly playable or a container
      if (/^\d+$/.test(localId)) {
        const item = await this.getItem(localId, { showLabelCache });
        if (item?.mediaUrl) {
          // Directly playable (movie, episode, track)
          return [item];
        }
        // It's a container - get its children
        const children = await this.getList(localId);
        const playables = [];
        for (const child of children) {
          const childId = child.id.replace('plex:', '');
          const resolved = await this._resolvePlayablesWithCache(childId, showLabelCache);
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
          const playable = await this.getItem(ratingKey, { showLabelCache });
          if (playable?.mediaUrl) playables.push(playable);
        } else if (item.itemType === 'container') {
          const childId = item.id.replace('plex:', '');
          const children = await this._resolvePlayablesWithCache(childId, showLabelCache);
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

    // Use proxy URL for thumbnails (not direct Plex URL)
    const thumbnail = item.thumb ? `${this.proxyPath}${item.thumb}` : null;

    // Build metadata with hierarchy info
    const metadata = {
      type: item.type,
      category: this.#mapTypeToCategory(item.type),
      year: item.year,
      // Rating fields for sorting in FitnessMenu
      rating: item.userRating ?? item.rating ?? item.audienceRating ?? null,
      userRating: item.userRating ?? null,
      librarySectionTitle: item.librarySectionTitle || null,
      childCount: item.leafCount || item.childCount || 0
    };

    // Add parent info based on type
    if (item.type === 'season') {
      metadata.parentTitle = item.parentTitle;
      metadata.parentType = 'show';
      metadata.parentRatingKey = item.parentRatingKey;
    } else if (item.type === 'album') {
      metadata.parentTitle = item.parentTitle;
      metadata.parentType = 'artist';
      metadata.parentRatingKey = item.parentRatingKey;
    } else if (['show', 'artist', 'movie', 'collection'].includes(item.type)) {
      // Top-level items: use collection for movies if available, else library
      if (item.type === 'movie' && Array.isArray(item.Collection) && item.Collection.length > 0) {
        const firstCollection = item.Collection[0];
        metadata.parentTitle = typeof firstCollection === 'string' ? firstCollection : firstCollection?.tag;
        metadata.parentType = 'collection';
      } else {
        metadata.parentTitle = item.librarySectionTitle || null;
        metadata.parentType = 'library';
      }
    }

    return new ListableItem({
      id: `plex:${id}`,
      source: 'plex',
      localId: String(id),
      title: item.title || item.titleSort || `[${item.type || 'Untitled'}]`,
      itemType: isContainer ? 'container' : 'leaf',
      childCount: item.leafCount || item.childCount || 0,
      thumbnail,
      metadata
    });
  }

  /**
   * Convert Plex metadata to PlayableItem (or ListableItem for containers)
   * @param {Object} item - Plex metadata object
   * @param {Object} [opts] - Options
   * @param {string[]} [opts.showLabels] - Pre-fetched show-level labels for episodes
   * @returns {PlayableItem|ListableItem}
   * @private
   */
  _toPlayableItem(item, opts = {}) {
    const isVideo = ['movie', 'episode', 'clip'].includes(item.type);
    const isAudio = ['track'].includes(item.type);

    // Non-playable types return as containers (shows, seasons, albums, etc.)
    if (!isVideo && !isAudio) {
      // Build metadata with hierarchy info
      const containerMetadata = {
        type: item.type,
        category: this.#mapTypeToCategory(item.type),
        year: item.year,
        studio: item.studio,
        summary: item.summary,
        librarySectionID: item.librarySectionID || null,
        librarySectionTitle: item.librarySectionTitle || null,
        childCount: item.leafCount || item.childCount || 0
      };

      // Add parent info for containers
      // Seasons have shows as parents, albums have artists as parents
      if (item.type === 'season') {
        containerMetadata.parentTitle = item.parentTitle; // Show title
        containerMetadata.parentType = 'show';
        containerMetadata.parentRatingKey = item.parentRatingKey;
      } else if (item.type === 'album') {
        containerMetadata.parentTitle = item.parentTitle; // Artist name
        containerMetadata.parentType = 'artist';
        containerMetadata.parentRatingKey = item.parentRatingKey;
      } else if (['show', 'artist', 'collection'].includes(item.type)) {
        // Top-level containers use library as parent
        containerMetadata.parentTitle = item.librarySectionTitle || null;
        containerMetadata.parentType = 'library';
      }

      return new ListableItem({
        id: `plex:${item.ratingKey}`,
        source: 'plex',
        localId: String(item.ratingKey),
        title: item.title || item.titleSort || `[${item.type || 'Untitled'}]`,
        itemType: 'container',
        childCount: item.leafCount || 0,
        thumbnail: item.thumb ? `${this.proxyPath}${item.thumb}` : null,
        metadata: containerMetadata
      });
    }

    // Extract labels from item
    const itemLabels = this._extractLabels(item.Label);

    // Merge with show-level labels if provided (for episodes)
    let allLabels = itemLabels;
    if (opts.showLabels && Array.isArray(opts.showLabels)) {
      allLabels = [...new Set([...itemLabels, ...opts.showLabels])];
    }

    // Build extended metadata for episodes/tracks
    // These fields are flattened to top level by the router for legacy compatibility
    const metadata = {
      type: item.type,
      category: this.#mapTypeToCategory(item.type),
      year: item.year,
      grandparentTitle: item.grandparentTitle,
      librarySectionID: item.librarySectionID || null,
      librarySectionTitle: item.librarySectionTitle || null,
      // Episode-specific properties for FitnessShow compatibility
      plex: item.ratingKey,
      key: item.ratingKey,
      label: item.title,
      summary: item.summary || null,
      tagline: item.tagline || null,
      studio: item.studio || null,
      thumbId: item.Media?.[0]?.Part?.[0]?.id ?? parseInt(item.ratingKey, 10),
      // Media info from Plex (for audio direct stream)
      Media: item.Media,
      // Labels for governance (merged item + show labels for episodes)
      labels: allLabels.length > 0 ? allLabels : null
    };

    // Add episode-specific fields (TV shows) - using canonical relative hierarchy names
    if (item.type === 'episode') {
      // Grandparent (show) info
      metadata.grandparentTitle = item.grandparentTitle;
      metadata.grandparentType = 'show';
      if (item.grandparentRatingKey) {
        metadata.grandparentId = item.grandparentRatingKey;
      }
      // Parent (season) info
      metadata.parentTitle = item.parentTitle;
      metadata.parentType = 'season';
      if (item.parentRatingKey) {
        metadata.parentId = item.parentRatingKey;
      }
      if (item.parentIndex !== undefined && item.parentIndex !== null) {
        metadata.parentIndex = parseInt(item.parentIndex);
      }
      // Parent thumbnail (season cover image)
      if (item.parentThumb) {
        metadata.parentThumb = `${this.proxyPath}${item.parentThumb}`;
      }
      // Item position
      if (item.index !== undefined && item.index !== null) {
        metadata.itemIndex = parseInt(item.index);
      }
    }

    // Add music-specific fields
    if (item.type === 'track') {
      metadata.artist = item.grandparentTitle || item.originalTitle;
      metadata.albumArtist = item.originalTitle;
      metadata.album = item.parentTitle;
      if (item.parentRatingKey) {
        metadata.albumId = item.parentRatingKey;
      }
      if (item.grandparentRatingKey) {
        metadata.artistId = item.grandparentRatingKey;
      }
    }

    // Add best-effort parent for top-level items (show, movie, artist, collection)
    // These don't have a parentTitle from Plex, so use library or collection as parent
    const topLevelTypes = ['show', 'movie', 'artist', 'collection'];
    if (topLevelTypes.includes(item.type)) {
      // For movies, try to use first collection as parent if available
      if (item.type === 'movie' && Array.isArray(item.Collection) && item.Collection.length > 0) {
        const firstCollection = item.Collection[0];
        metadata.parentTitle = typeof firstCollection === 'string' ? firstCollection : firstCollection?.tag;
        metadata.parentType = 'collection';
      } else {
        // Fall back to library name as parent
        metadata.parentTitle = item.librarySectionTitle || null;
        metadata.parentType = 'library';
      }
    }

    // Use proxy URL for thumbnails with fallback chain (episode -> season -> show)
    const thumbPath = item.thumb || item.parentThumb || item.grandparentThumb;
    const thumbnail = thumbPath ? `${this.proxyPath}${thumbPath}` : null;

    return new PlayableItem({
      id: `plex:${item.ratingKey}`,
      source: 'plex',
      localId: String(item.ratingKey),
      title: item.title || item.titleSort || `[${item.type || 'Untitled'}]`,
      mediaType: isVideo ? 'video' : 'audio',
      mediaUrl: `/api/v1/proxy/plex/stream/${item.ratingKey}`,
      duration: item.duration ? Math.floor(item.duration / 1000) : null,
      resumable: isVideo,
      resumePosition: item.viewOffset ? Math.floor(item.viewOffset / 1000) : null,
      thumbnail,
      metadata
    });
  }

  /**
   * Get storage path for progress persistence
   * @param {string} id - Item ID
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    // Strip plex: prefix if present
    const localId = String(id).replace(/^plex:/, '');

    try {
      const item = await this.getItem(`plex:${localId}`);
      if (item?.metadata?.librarySectionID) {
        const libraryId = item.metadata.librarySectionID;
        const libraryName = (item.metadata.librarySectionTitle || 'media')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return `plex/${libraryId}_${libraryName}`;
      }
    } catch (e) {
      // Fall back to generic plex path on error
    }
    return 'plex';
  }

  // ===========================================================================
  // STREAMING & TRANSCODE METHODS
  // ===========================================================================

  /**
   * Generate unique session identifiers for Plex streaming
   * @param {string} [clientSession] - Optional client-provided session ID
   * @returns {{sessionUUID: string, clientIdentifier: string, sessionIdentifier: string}}
   * @private
   */
  _generateSessionIds(clientSession = null) {
    const sessionUUID = Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const clientIdentifier = clientSession || `api-${sessionUUID}`;
    const sessionIdentifier = clientSession ? `${clientSession}-${sessionUUID}` : sessionUUID;
    return { sessionUUID, clientIdentifier, sessionIdentifier };
  }

  /**
   * Request transcode decision from Plex server
   * Authorizes a streaming session and determines whether to direct play or transcode
   *
   * @param {string} key - Plex rating key
   * @param {Object} [opts] - Options
   * @param {string} [opts.session] - Client session ID for multi-player isolation
   * @param {number} [opts.maxVideoBitrate] - Maximum video bitrate in kbps
   * @param {string} [opts.maxResolution] - Maximum resolution (e.g., "1080p", "720p")
   * @param {number} [opts.startOffset] - Start offset in seconds
   * @returns {Promise<Object>} Decision result with session identifiers and stream info
   */
  async requestTranscodeDecision(key, opts = {}) {
    const {
      maxVideoBitrate = null,
      maxResolution = null,
      session = null,
      startOffset = 0
    } = opts;

    const { clientIdentifier, sessionIdentifier } = this._generateSessionIds(session);

    // Build decision endpoint URL
    const params = new URLSearchParams();
    params.append('path', `/library/metadata/${key}`);
    params.append('protocol', this.protocol);
    params.append('X-Plex-Client-Identifier', clientIdentifier);
    params.append('X-Plex-Session-Identifier', sessionIdentifier);
    params.append('X-Plex-Platform', this.platform);
    params.append('autoAdjustQuality', '1');
    params.append('directPlay', '0');
    params.append('directStream', '1');
    params.append('subtitleSize', '100');
    params.append('audioBoost', '100');
    params.append('fastSeek', '1');
    if (startOffset > 0) {
      params.append('offset', String(Math.floor(startOffset)));
    }
    params.append('X-Plex-Token', this.token);

    if (maxVideoBitrate != null) {
      params.append('maxVideoBitrate', String(maxVideoBitrate));
    }
    if (maxResolution != null) {
      params.append('maxVideoResolution', String(maxResolution));
    }

    const decisionUrl = `${this.host}/video/:/transcode/universal/decision?${params.toString()}`;

    try {
      const response = await this.#httpClient.get(decisionUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new InfrastructureError(`Decision request failed: ${response.status}`, {
        code: 'EXTERNAL_SERVICE_ERROR',
        service: 'Plex',
        statusCode: response.status
      });
      }

      const container = response.data?.MediaContainer;
      if (!container) {
        throw new InfrastructureError('Invalid decision response: missing MediaContainer', {
        code: 'INVALID_RESPONSE',
        service: 'Plex'
      });
      }

      // Extract decision codes
      const generalDecisionCode = parseInt(container.generalDecisionCode, 10) || 0;
      const generalDecisionText = container.generalDecisionText || '';
      const transcodeDecisionCode = parseInt(container.transcodeDecisionCode, 10) || 0;
      const transcodeDecisionText = container.transcodeDecisionText || '';

      // Extract direct stream path if available
      let directStreamPath = null;
      let directStreamContainer = null;
      const video = Array.isArray(container.Video) ? container.Video[0] : container.Video;
      if (video?.Media) {
        const media = Array.isArray(video.Media) ? video.Media[0] : video.Media;
        if (media?.Part) {
          const part = Array.isArray(media.Part) ? media.Part[0] : media.Part;
          directStreamPath = part?.key || null;
          directStreamContainer = media?.container || null;
        }
      }

      return {
        success: true,
        sessionIdentifier,
        clientIdentifier,
        decision: {
          generalDecisionCode,
          generalDecisionText,
          transcodeDecisionCode,
          transcodeDecisionText,
          directStreamPath,
          directStreamContainer,
          canDirectPlay: generalDecisionCode === 2000,
          canTranscode: transcodeDecisionCode === 1000 || generalDecisionCode !== 2000
        }
      };
    } catch (error) {
      console.error('[PlexAdapter] requestTranscodeDecision error:', error.message);
      return {
        success: false,
        error: error.message,
        sessionIdentifier,
        clientIdentifier
      };
    }
  }

  /**
   * Build a transcode URL for video streaming
   * @param {string} key - Plex rating key
   * @param {string} clientIdentifier - Client identifier
   * @param {string} sessionIdentifier - Session identifier
   * @param {number} [maxVideoBitrate] - Max video bitrate
   * @param {string} [maxResolution] - Max resolution
   * @returns {string} Transcode URL
   * @private
   */
  _buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate = null, maxResolution = null) {
    const mediaBufferSize = 5242880 * 20; // 100MB buffer
    const baseParams = [
      `path=%2Flibrary%2Fmetadata%2F${key}`,
      `protocol=${this.protocol}`,
      `X-Plex-Client-Identifier=${clientIdentifier}`,
      `X-Plex-Session-Identifier=${sessionIdentifier}`,
      `X-Plex-Platform=${this.platform}`,
      `autoAdjustQuality=1`,
      `fastSeek=1`,
      `mediaBufferSize=${mediaBufferSize}`,
      `X-Plex-Client-Profile-Extra=${encodeURIComponent('append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=h264,hevc&audioCodec=aac&protocol=dash)')}`
    ];

    if (maxVideoBitrate != null) {
      baseParams.push(`maxVideoBitrate=${encodeURIComponent(maxVideoBitrate)}`);
    }
    if (maxResolution != null) {
      baseParams.push(`maxVideoResolution=${encodeURIComponent(maxResolution)}`);
    }

    return `${this.proxyPath}/video/:/transcode/universal/start.mpd?${baseParams.join('&')}`;
  }

  /**
   * Generate a streaming media URL for a playable item
   * Handles both video (with transcode decision) and audio (direct stream)
   *
   * @param {Object|string} itemData - Item metadata object or rating key
   * @param {Object} [opts] - Options
   * @param {number} [opts.maxVideoBitrate] - Maximum video bitrate in kbps
   * @param {string} [opts.maxResolution] - Maximum resolution (e.g., "1080p")
   * @param {string} [opts.session] - Client session ID
   * @param {number} [opts.startOffset] - Start offset in seconds
   * @returns {Promise<string|null>} Streaming URL or null on failure
   */
  async loadMediaUrl(itemData, opts = {}) {
    try {
      // If string ID provided, fetch metadata first
      if (typeof itemData === 'string') {
        const data = await this.client.getMetadata(itemData);
        const meta = data?.MediaContainer?.Metadata?.[0];
        if (!meta) return null;
        itemData = meta;
      }
      if (!itemData) return null;

      const key = itemData.ratingKey || itemData.plex;
      const type = itemData.type;

      // If not a playable type, recursively get a playable item
      if (!['episode', 'movie', 'track'].includes(type)) {
        const list = await this.getList(key);
        if (!list.length) return null;
        // Get first item (smart selection will be added later)
        const firstItem = list[0];
        const childKey = firstItem.id.replace('plex:', '');
        return this.loadMediaUrl(childKey, opts);
      }

      const {
        maxVideoBitrate = null,
        maxResolution = null,
        session = null,
        startOffset = 0
      } = opts;

      const mediaType = ['track'].includes(type) ? 'audio' : 'video';

      if (mediaType === 'audio') {
        // Audio: Direct stream without transcode decision
        const { clientIdentifier, sessionIdentifier } = this._generateSessionIds(session ? `${session}-audio` : null);
        const mediaKey = itemData?.Media?.[0]?.Part?.[0]?.key;
        if (!mediaKey) throw new InfrastructureError('Media key not found for audio', {
        code: 'NOT_FOUND',
        service: 'Plex'
      });

        const separator = mediaKey.includes('?') ? '&' : '?';
        return `${this.proxyPath}${mediaKey}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`;
      } else {
        // Video: Use decision API
        if (!key) throw new InfrastructureError('Rating key not found for video', {
        code: 'NOT_FOUND',
        service: 'Plex'
      });

        const decisionResult = await this.requestTranscodeDecision(key, {
          maxVideoBitrate,
          maxResolution,
          session,
          startOffset
        });

        if (!decisionResult.success) {
          // Fallback to transcode URL
          const { sessionIdentifier, clientIdentifier } = decisionResult;
          return this._buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate, maxResolution);
        }

        const { sessionIdentifier, clientIdentifier, decision } = decisionResult;

        // Use direct stream if available
        if (decision.canDirectPlay && decision.directStreamPath) {
          const directPath = decision.directStreamPath;
          const separator = directPath.includes('?') ? '&' : '?';
          return `${this.proxyPath}${directPath}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`;
        }

        // Otherwise use transcode
        return this._buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate, maxResolution);
      }
    } catch (error) {
      console.error('[PlexAdapter] loadMediaUrl error:', error.message);
      return null;
    }
  }

  /**
   * Get container metadata bundled with its children
   * @param {string} id - Compound ID
   * @returns {Promise<{container: Object, children: Array}|null>}
   */
  async getContainerWithChildren(id) {
    const [container, children] = await Promise.all([
      this.getContainerInfo(id),
      this.getList(id)
    ]);

    if (!container) return null;

    return {
      container,
      children: children || []
    };
  }

  /**
   * Get extended container metadata for FitnessShow info panel
   * Returns raw Plex metadata including summary, labels, studio, etc.
   * @param {string} id - Container ID (show, collection, etc.)
   * @returns {Promise<Object|null>}
   */
  async getContainerInfo(id) {
    try {
      // Strip all plex: prefixes (handles plex:plex:123 case from frontend)
      let localId = id || '';
      while (localId.startsWith('plex:')) {
        localId = localId.slice(5);
      }
      if (!localId || !/^\d+$/.test(localId)) return null;

      const data = await this.client.getMetadata(localId);
      const item = data.MediaContainer?.Metadata?.[0];
      if (!item) return null;

      // Extract labels from Plex Label objects only (not Collection or Genre)
      // Legacy: item['labels'] = item.Label? item.Label.map(x => x['tag'].toLowerCase()) : [];
      const labels = this._extractLabels(item.Label);

      // Extract collections from Collection array
      const collections = [];
      if (Array.isArray(item.Collection)) {
        for (const col of item.Collection) {
          if (typeof col === 'string') collections.push(col);
          else if (col?.tag) collections.push(col.tag);
        }
      }

      return {
        key: localId,
        title: item.title,
        image: item.thumb ? `${this.proxyPath}${item.thumb}` : null,
        summary: item.summary || null,
        tagline: item.tagline || null,
        year: item.year || null,
        studio: item.studio || null,
        type: item.type || null,
        contentType: item.type || null,
        labels,
        collections,
        // Additional fields that might be useful
        duration: item.duration ? Math.floor(item.duration / 1000) : null,
        ratingKey: item.ratingKey,
        childCount: item.leafCount || item.childCount || 0
      };
    } catch (err) {
      console.error('[PlexAdapter] getContainerInfo error:', err.message);
      return null;
    }
  }

  // ===========================================================================
  // SMART EPISODE SELECTION
  // ===========================================================================

  /**
   * Load viewing history from mediaProgressMemory (async)
   * @param {string} [storagePath='plex'] - Storage path to load from
   * @returns {Promise<Object>} History object mapping bare plex keys to watch state
   */
  async _loadViewingHistoryAsync(storagePath = 'plex') {
    if (!this.mediaProgressMemory) {
      return {};
    }

    try {
      const states = await this.mediaProgressMemory.getAll(storagePath);
      const history = {};
      for (const state of states) {
        // Use resolver to parse compound key, or strip prefix as fallback
        let bareKey;
        if (this.mediaKeyResolver) {
          const { id } = this.mediaKeyResolver.parse(state.itemId);
          bareKey = id;
        } else {
          bareKey = state.itemId.replace(/^plex:/, '');
        }
        history[bareKey] = {
          playhead: state.playhead || 0,
          duration: state.duration || 0,
          percent: state.percent || 0,
          lastPlayed: state.lastPlayed || null
        };
      }
      return history;
    } catch (e) {
      console.error('[PlexAdapter] Error loading history from mediaProgressMemory:', e.message);
      return {};
    }
  }

  /**
   * Clear watch status for given keys
   * Note: This is currently a no-op. Clearing should be done through mediaProgressMemory.delete()
   * @param {string[]} keys - Plex keys to clear
   * @private
   */
  _clearWatchedItems(keys) {
    // No-op: clearing watch status should be handled through mediaProgressMemory directly
    // This method is kept for API compatibility with _selectEpisodeByPriority
  }

  /**
   * Check if an item is considered watched (>90% or <60 seconds remaining)
   * @param {Object} item - Item with percent and seconds
   * @param {number} [threshold=90] - Percent threshold for watched
   * @returns {boolean}
   * @private
   */
  _isWatched(item, threshold = 90) {
    const { percent = 0, seconds = 0 } = item || {};
    if (percent >= threshold) return true;
    // Check seconds remaining
    if (seconds > 0 && percent > 0) {
      const duration = seconds / (percent / 100);
      const remaining = duration - seconds;
      if (remaining <= 60) return true;
    }
    return false;
  }

  /**
   * Categorize items by watch status
   * @param {string[]} keys - Array of plex keys
   * @param {Object} log - Viewing history log
   * @returns {{watched: string[], inProgress: string[], unwatched: string[]}}
   * @private
   */
  _categorizeByWatchStatus(keys, log) {
    const watched = [];
    const inProgress = [];
    const unwatched = [];

    for (const key of keys) {
      const entry = log[key];
      const playhead = entry?.playhead ?? 0;
      const duration = entry?.duration ?? 0;
      const percent = entry?.percent ?? (duration > 0 ? (playhead / duration) * 100 : 0);

      if (this._isWatched({ percent, seconds: playhead })) {
        watched.push(key);
      } else if (percent > 0) {
        inProgress.push(key);
      } else {
        unwatched.push(key);
      }
    }

    return { watched, inProgress, unwatched };
  }

  /**
   * Select an episode by priority: unwatched > in-progress > restart watched
   * @param {string[]} unwatched - Unwatched keys
   * @param {string[]} inProgress - In-progress keys
   * @param {string[]} watched - Watched keys
   * @param {Object} log - Viewing history log
   * @param {boolean} [shuffle=false] - Whether to shuffle within category
   * @returns {[string|null, number, number]} [key, seconds, percent]
   * @private
   */
  _selectEpisodeByPriority(unwatched, inProgress, watched, log, shuffle = false) {
    // Priority 1: First unwatched
    if (unwatched.length > 0) {
      const selected = shuffle ? unwatched[Math.floor(Math.random() * unwatched.length)] : unwatched[0];
      return [selected, 0, 0];
    }

    // Priority 2: First in-progress
    if (inProgress.length > 0) {
      const selected = shuffle ? inProgress[Math.floor(Math.random() * inProgress.length)] : inProgress[0];
      const entry = log[selected] || {};
      return [selected, entry.playhead ?? 0, entry.percent ?? 0];
    }

    // Priority 3: Restart from first watched (clear watch status)
    if (watched.length > 0) {
      this._clearWatchedItems(watched);
      const selected = watched[0];
      return [selected, 0, 0];
    }

    return [null, 0, 0];
  }

  /**
   * Select which key to play from a list of keys
   * Uses viewing history to pick unwatched > in-progress > restart
   *
   * @param {string[]|Object[]} keys - Array of plex keys or items with .plex property
   * @param {boolean} [shuffle=false] - Whether to shuffle within category
   * @param {string} [storagePath='plex'] - Storage path for history lookup
   * @returns {Promise<[string|null, number, number]>} [key, seconds, percent]
   */
  async selectKeyToPlay(keys, shuffle = false, storagePath = 'plex') {
    // Normalize keys array
    keys = Array.isArray(keys) ? keys : [];
    if (keys.length > 0 && keys[0]?.plex) {
      keys = keys.map(x => x.plex || x.ratingKey || x);
    }
    if (keys.length === 0) return [null, 0, 0];

    // Load viewing history
    const log = await this._loadViewingHistoryAsync(storagePath);

    // Categorize by watch status
    const { watched, inProgress, unwatched } = this._categorizeByWatchStatus(keys, log);

    // Select by priority
    return this._selectEpisodeByPriority(unwatched, inProgress, watched, log, shuffle);
  }

  /**
   * Load a single playable item from a container key with smart selection
   * Drills down containers until finding a playable item
   *
   * @param {string} key - Container or item key
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.shuffle] - Whether to shuffle selection
   * @param {string} [opts.storagePath='plex'] - Storage path for history lookup
   * @returns {Promise<Object|null>} Playable item with media URL and resume info
   */
  async loadPlayableItemFromKey(key, opts = {}) {
    const { shuffle = false, storagePath = 'plex' } = opts;

    // Strip plex: prefix if present
    key = key?.replace(/^plex:/, '') || '';
    if (!key) return null;

    // Get item metadata
    const item = await this.getItem(key);
    if (!item) return null;

    // If directly playable, return it
    if (item.mediaUrl && ['movie', 'episode', 'track'].includes(item.metadata?.type)) {
      const log = await this._loadViewingHistoryAsync(storagePath);
      const entry = log[key] || {};
      return {
        ...item,
        listkey: key,
        percent: entry.percent ?? 0,
        seconds: entry.playhead ?? 0
      };
    }

    // Otherwise it's a container - get children and select
    const list = await this.getList(key);
    if (!list.length) return null;

    // Get plex keys from list
    const keys = list.map(i => i.id.replace('plex:', ''));

    // Use smart selection
    const [selectedKey, seconds, percent] = await this.selectKeyToPlay(keys, shuffle, storagePath);
    if (!selectedKey) return null;

    // Recursively load the selected item (may need to drill down further)
    const selectedItem = await this.loadPlayableItemFromKey(selectedKey, opts);
    if (selectedItem) {
      selectedItem.listkey = key;
      selectedItem.listType = item.metadata?.type;
    }

    return selectedItem;
  }

  /**
   * Load a queue of playable items from a container
   * @param {string} key - Container key
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.shuffle] - Whether to shuffle the queue
   * @param {string} [opts.storagePath='plex'] - Storage path for history lookup
   * @returns {Promise<Object[]>} Array of playable items
   */
  async loadPlayableQueueFromKey(key, opts = {}) {
    const { shuffle = false, storagePath = 'plex' } = opts;

    // Resolve to playable items
    const playables = await this.resolvePlayables(key);
    if (!playables.length) return [];

    // Add viewing history to each item
    const log = await this._loadViewingHistoryAsync(storagePath);
    const queue = playables.map(item => {
      const itemKey = item.id.replace('plex:', '');
      const entry = log[itemKey] || {};
      return {
        ...item,
        percent: entry.percent ?? 0,
        seconds: entry.playhead ?? 0
      };
    });

    // Shuffle if requested
    if (shuffle) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }

    return queue;
  }

  /**
   * Load a single item from a watchlist with priority selection
   * Priority: in_progress > urgent (skipAfter within 8 days) > normal
   *
   * @param {Object} watchlistData - Watchlist configuration object
   *   Keys are plex rating keys, values are:
   *   - watched: boolean - Skip if true
   *   - hold: boolean - Skip if true
   *   - skipAfter: string - Date after which to skip (ISO format)
   *   - waitUntil: string - Date until which to wait (ISO format)
   *   - program: string - Group identifier for selecting within program
   *   - index: number - Episode index within program
   *   - uid: string - Unique identifier for the item
   * @param {string} [storagePath='plex'] - Storage path for history lookup
   * @returns {Promise<[string|null, number, string|null]>} [plexKey, seekSeconds, uid]
   */
  async loadSingleFromWatchlist(watchlistData, storagePath = 'plex') {
    if (!watchlistData || typeof watchlistData !== 'object') {
      return [null, 0, null];
    }

    const log = await this._loadViewingHistoryAsync(storagePath);
    const now = new Date();
    const twoDaysFromNow = new Date(now);
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    const eightDaysFromNow = new Date(now);
    eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);

    // Categorize by priority
    const candidates = {
      in_progress: {},
      urgent: {},
      normal: {}
    };

    for (const [plexKey, item] of Object.entries(watchlistData)) {
      // Skip conditions
      if (item.watched) continue;
      if (item.hold) continue;

      // Check skipAfter date
      if (item.skipAfter) {
        const skipAfter = new Date(item.skipAfter);
        if (skipAfter <= now) continue;
      }

      // Check waitUntil date
      if (item.waitUntil) {
        const waitUntil = new Date(item.waitUntil);
        if (waitUntil >= twoDaysFromNow) continue;
      }

      // Check watch status from history
      const entry = log[plexKey];
      const playhead = entry?.playhead ?? 0;
      const duration = entry?.duration ?? 0;
      const percent = entry?.percent ?? (duration > 0 ? (playhead / duration) * 100 : 0);

      if (this._isWatched({ percent, seconds: playhead })) continue;

      // Determine priority
      let priority = 'normal';
      if (percent > 0) {
        priority = 'in_progress';
      } else if (item.skipAfter) {
        const skipAfter = new Date(item.skipAfter);
        if (skipAfter <= eightDaysFromNow) {
          priority = 'urgent';
        }
      }

      // Group by program
      const program = item.program || 'default';
      const index = item.index || 0;
      if (!candidates[priority][program]) {
        candidates[priority][program] = {};
      }
      candidates[priority][program][index] = [plexKey, item.uid, playhead];
    }

    // Select by priority
    let chosen = null;
    if (Object.keys(candidates.in_progress).length > 0) {
      chosen = candidates.in_progress;
    } else if (Object.keys(candidates.urgent).length > 0) {
      chosen = candidates.urgent;
    } else if (Object.keys(candidates.normal).length > 0) {
      chosen = candidates.normal;
    }

    if (!chosen || Object.keys(chosen).length === 0) {
      return [null, 0, null];
    }

    // Shuffle programs and pick one
    const programs = Object.values(chosen);
    const shuffledPrograms = [...programs].sort(() => Math.random() - 0.5);
    const selectedProgram = shuffledPrograms[0];

    // Sort by index and get first item
    const sortedIndices = Object.keys(selectedProgram).sort((a, b) => parseInt(a) - parseInt(b));
    const [selectedKey, uid, playhead] = selectedProgram[sortedIndices[0]];

    // Only seek if playhead is significant (> 90 seconds would restart)
    const seekTo = playhead > 90 ? 0 : playhead;

    return [selectedKey, seekTo, uid];
  }

  // ===========================================================================
  // STREAMING URL GENERATION
  // ===========================================================================

  /**
   * Generate unique session identifiers for Plex streaming
   * @param {string} [session] - Optional client session from frontend
   * @returns {{clientIdentifier: string, sessionIdentifier: string, sessionUUID: string}}
   * @private
   */
  _generateSessionIds(session = null) {
    // Generate a unique UUID for this request
    const sessionUUID = Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    // clientIdentifier: Use frontend-provided session for multi-player isolation.
    // If no session provided, generate unique ID per request to prevent collisions.
    const clientIdentifier = session || `api-${sessionUUID}`;

    // sessionIdentifier: Always unique per request. If we have a stable client session,
    // append the UUID so Plex can track it's from the same client but a new segment request.
    const sessionIdentifier = session ? `${session}-${sessionUUID}` : sessionUUID;

    return { clientIdentifier, sessionIdentifier, sessionUUID };
  }

  /**
   * Determine media type from Plex item type
   * @param {string} type - Plex item type (movie, episode, track, etc.)
   * @returns {string} Media type (dash_video, audio, or original type)
   * @private
   */
  _determineMediaType(type) {
    const videoTypes = ['movie', 'episode', 'clip', 'short', 'trailer', 'season', 'show'];
    const audioTypes = ['track', 'album', 'artist'];
    if (videoTypes.includes(type)) return 'dash_video';
    if (audioTypes.includes(type)) return 'audio';
    return type;
  }

  /**
   * Request a transcode decision from Plex before streaming video.
   * This authorizes the session and determines whether direct play or transcode is needed.
   *
   * SESSION IDENTIFIER ARCHITECTURE:
   * - clientIdentifier: Identifies the "device" or player instance. Stays stable across
   *   seeks/reloads. Used by Plex to track which client is playing.
   * - sessionIdentifier: Unique per transcode request/segment fetch.
   *
   * @param {string} key - The Plex rating key for the media item
   * @param {Object} [opts] - Options for the decision request
   * @param {string} [opts.session] - Client session ID from frontend
   * @param {number} [opts.maxVideoBitrate] - Maximum video bitrate in kbps
   * @param {string} [opts.maxResolution] - Maximum resolution (e.g., "1080p", "720p")
   * @param {number} [opts.startOffset] - Start offset in seconds
   * @returns {Promise<Object>} Decision result with session identifiers and stream info
   */
  async requestTranscodeDecision(key, opts = {}) {
    const {
      maxVideoBitrate = null,
      maxResolution = null,
      session = null,
      startOffset = 0
    } = opts;

    const { clientIdentifier, sessionIdentifier } = this._generateSessionIds(session);

    // Build decision endpoint URL with URLSearchParams for proper encoding
    const params = new URLSearchParams();
    params.append('path', `/library/metadata/${key}`);
    params.append('protocol', this.protocol);
    params.append('X-Plex-Client-Identifier', clientIdentifier);
    params.append('X-Plex-Session-Identifier', sessionIdentifier);
    params.append('X-Plex-Platform', this.platform);
    params.append('autoAdjustQuality', '1');
    params.append('directPlay', '0');
    params.append('directStream', '1');
    params.append('subtitleSize', '100');
    params.append('audioBoost', '100');
    params.append('fastSeek', '1');
    if (startOffset > 0) {
      params.append('offset', String(Math.floor(startOffset)));
    }
    params.append('X-Plex-Token', this.token);

    if (maxVideoBitrate != null) {
      params.append('maxVideoBitrate', String(maxVideoBitrate));
    }
    if (maxResolution != null) {
      params.append('maxVideoResolution', String(maxResolution));
    }

    const decisionUrl = `/video/:/transcode/universal/decision?${params.toString()}`;

    try {
      const response = await this.client.request(decisionUrl);

      // Parse decision response
      const container = response?.MediaContainer;
      if (!container) {
        throw new InfrastructureError('Invalid decision response: missing MediaContainer', {
        code: 'INVALID_RESPONSE',
        service: 'Plex'
      });
      }

      // Extract decision codes
      const generalDecisionCode = parseInt(container.generalDecisionCode, 10) || 0;
      const generalDecisionText = container.generalDecisionText || '';
      const transcodeDecisionCode = parseInt(container.transcodeDecisionCode, 10) || 0;
      const transcodeDecisionText = container.transcodeDecisionText || '';

      // Extract direct stream path if available (for direct play)
      let directStreamPath = null;
      let directStreamContainer = null;
      const video = Array.isArray(container.Video) ? container.Video[0] : container.Video;
      if (video?.Media) {
        const media = Array.isArray(video.Media) ? video.Media[0] : video.Media;
        if (media?.Part) {
          const part = Array.isArray(media.Part) ? media.Part[0] : media.Part;
          directStreamPath = part?.key || null;
          directStreamContainer = media?.container || null;
        }
      }

      return {
        success: true,
        sessionIdentifier,
        clientIdentifier,
        decision: {
          generalDecisionCode,
          generalDecisionText,
          transcodeDecisionCode,
          transcodeDecisionText,
          directStreamPath,
          directStreamContainer,
          canDirectPlay: generalDecisionCode === 2000,
          canTranscode: transcodeDecisionCode === 1000 || generalDecisionCode !== 2000
        }
      };
    } catch (error) {
      console.error('[PlexAdapter] requestTranscodeDecision error:', error.message);
      return {
        success: false,
        error: error.message,
        sessionIdentifier,
        clientIdentifier
      };
    }
  }

  /**
   * Build a transcode URL for video streaming
   * @param {string} key - Plex rating key
   * @param {string} clientIdentifier - Client identifier
   * @param {string} sessionIdentifier - Session identifier
   * @param {number} [maxVideoBitrate] - Max video bitrate
   * @param {string} [maxResolution] - Max resolution
   * @returns {string} Transcode URL
   * @private
   */
  _buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate = null, maxResolution = null) {
    const mediaBufferSize = 5242880 * 20; // 100MB buffer for better streaming
    const baseParams = [
      `path=%2Flibrary%2Fmetadata%2F${key}`,
      `protocol=${this.protocol}`,
      `X-Plex-Client-Identifier=${clientIdentifier}`,
      `X-Plex-Session-Identifier=${sessionIdentifier}`,
      `X-Plex-Platform=${this.platform}`,
      'autoAdjustQuality=1',
      'fastSeek=1',
      `mediaBufferSize=${mediaBufferSize}`,
      `X-Plex-Client-Profile-Extra=${encodeURIComponent('append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=h264,hevc&audioCodec=aac&protocol=dash)')}`
    ];

    if (maxVideoBitrate != null) {
      baseParams.push(`maxVideoBitrate=${encodeURIComponent(maxVideoBitrate)}`);
    }
    if (maxResolution != null) {
      baseParams.push(`maxVideoResolution=${encodeURIComponent(maxResolution)}`);
    }

    return `${this.proxyPath}/video/:/transcode/universal/start.mpd?${baseParams.join('&')}`;
  }

  /**
   * Generate a streaming URL for a Plex media item.
   *
   * For video: Uses the decision API to authorize the session, then returns
   * either a direct stream URL or a transcode URL.
   *
   * For audio: Returns a direct stream URL without transcode decision.
   *
   * @param {string|Object} itemOrKey - Plex rating key or item metadata object
   * @param {number} [attempt=0] - Retry attempt counter
   * @param {Object} [opts] - Streaming options
   * @param {number} [opts.maxVideoBitrate] - Maximum video bitrate in kbps
   * @param {string} [opts.maxResolution] - Maximum resolution (e.g., "1080p")
   * @param {string} [opts.maxVideoResolution] - Alias for maxResolution
   * @param {string} [opts.session] - Client session ID for multi-player isolation
   * @param {number} [opts.startOffset] - Start offset in seconds
   * @returns {Promise<string|null>} Streaming URL or null if generation failed
   */
  async loadMediaUrl(itemOrKey, attempt = 0, opts = {}) {
    try {
      // Normalize input: accept rating key string or item object
      let itemData;
      let ratingKey;

      if (typeof itemOrKey === 'string' || typeof itemOrKey === 'number') {
        ratingKey = String(itemOrKey).replace(/^plex:/, '');
        const data = await this.client.getMetadata(ratingKey);
        itemData = data?.MediaContainer?.Metadata?.[0];
        if (!itemData) return null;
      } else {
        itemData = itemOrKey;
        ratingKey = itemData?.ratingKey || itemData?.plex;
      }

      if (!itemData || !ratingKey) return null;

      const { type } = itemData;
      const mediaType = this._determineMediaType(type);

      // If not directly playable, drill down to find playable item
      if (!['movie', 'episode', 'track', 'clip'].includes(type)) {
        // For shows/seasons/albums, would need to select a child item
        // This is handled by loadPlayableItemFromKey in the legacy code
        console.warn('[PlexAdapter] loadMediaUrl called with non-playable type:', type);
        return null;
      }

      const {
        maxVideoBitrate = null,
        maxResolution = null,
        maxVideoResolution = null,
        session = null,
        startOffset = 0
      } = opts;

      const resolvedMaxResolution = maxResolution ?? maxVideoResolution;

      if (mediaType === 'audio') {
        // Audio: Direct stream without transcode decision
        const { clientIdentifier, sessionIdentifier } = this._generateSessionIds(
          session ? `${session}-audio` : null
        );

        const mediaKey = itemData?.Media?.[0]?.Part?.[0]?.key;
        if (!mediaKey) {
          console.error('[PlexAdapter] Media key not found for audio item');
          return null;
        }

        const separator = mediaKey.includes('?') ? '&' : '?';
        return `${this.proxyPath}${mediaKey}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`;
      }

      // Video: Use decision API to authorize session
      const decisionResult = await this.requestTranscodeDecision(ratingKey, {
        maxVideoBitrate,
        maxResolution: resolvedMaxResolution,
        session,
        startOffset
      });

      if (!decisionResult.success) {
        console.warn('[PlexAdapter] Decision failed, falling back to transcode URL');
        const { sessionIdentifier, clientIdentifier } = decisionResult;
        return this._buildTranscodeUrl(
          ratingKey,
          clientIdentifier,
          sessionIdentifier,
          maxVideoBitrate,
          resolvedMaxResolution
        );
      }

      const { sessionIdentifier, clientIdentifier, decision } = decisionResult;

      // If direct play is available, use it
      if (decision.canDirectPlay && decision.directStreamPath) {
        const directPath = decision.directStreamPath;
        const separator = directPath.includes('?') ? '&' : '?';
        return `${this.proxyPath}${directPath}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`;
      }

      // Otherwise use transcode URL
      return this._buildTranscodeUrl(
        ratingKey,
        clientIdentifier,
        sessionIdentifier,
        maxVideoBitrate,
        resolvedMaxResolution
      );
    } catch (error) {
      console.error('[PlexAdapter] loadMediaUrl error:', error.message);
      return null;
    }
  }

  /**
   * Alias for loadMediaUrl to match legacy interface
   * @deprecated Use loadMediaUrl instead
   */
  async loadMediaUrlLegacy(itemOrKey, attempt = 0, opts = {}) {
    return this.loadMediaUrl(itemOrKey, attempt, opts);
  }

  /**
   * Get a streaming URL for a Plex item (convenience method for routers)
   * @param {string} id - Plex rating key
   * @param {number} [startOffset=0] - Start offset in seconds
   * @param {Object} [opts] - Additional options
   * @returns {Promise<string|null>}
   */
  async getMediaUrl(id, startOffset = 0, opts = {}) {
    const ratingKey = String(id).replace(/^plex:/, '');
    return this.loadMediaUrl(ratingKey, 0, { ...opts, startOffset });
  }

  // ===========================================================================
  // IMediaSearchable INTERFACE IMPLEMENTATION
  // ===========================================================================

  /**
   * Search for media items matching query
   * Implements IMediaSearchable.search()
   *
   * @param {Object} query - MediaSearchQuery
   * @param {string} [query.text] - Free text search (title, description)
   * @param {'image'|'video'|'audio'} [query.mediaType] - Filter by type
   * @param {string[]} [query.tags] - Filter by Plex labels
   * @param {number} [query.ratingMin] - Minimum rating (1-5)
   * @param {number} [query.take] - Limit results
   * @param {number} [query.skip] - Offset for pagination
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    try {
      // Validate that we have a text query (Plex requires search text)
      if (!query.text) {
        return { items: [], total: 0 };
      }

      // Build Plex search options
      const options = {
        limit: query.take || 50
      };

      // Execute hub search
      const result = await this.client.hubSearch(query.text, options);
      let items = result.results || [];

      // Filter by mediaType if specified
      if (query.mediaType) {
        const typeMap = {
          'video': ['movie', 'episode', 'clip'],
          'audio': ['track'],
          'image': [] // Plex doesn't have images
        };
        const allowedTypes = typeMap[query.mediaType] || [];
        if (allowedTypes.length > 0) {
          items = items.filter(item => allowedTypes.includes(item.type));
        }
      }

      // Apply skip offset
      if (query.skip && query.skip > 0) {
        items = items.slice(query.skip);
      }

      // Also search playlists and collections
      const [matchingPlaylists, matchingCollections] = await Promise.all([
        this._searchPlaylists(query.text),
        this._searchCollections(query.text)
      ]);

      // Convert to PlayableItem/ListableItem
      const showLabelCache = new Map();
      const convertedItems = await Promise.all(
        items.map(async (item) => {
          // For playable types, get full metadata
          if (['movie', 'episode', 'track', 'clip'].includes(item.type)) {
            const fullItem = await this.getItem(item.ratingKey, { showLabelCache });
            if (fullItem) {
              // Filter by rating if specified
              if (query.ratingMin) {
                const rating = fullItem.metadata?.rating || fullItem.metadata?.userRating;
                // Plex ratings are 0-10, normalize to 1-5
                const normalizedRating = rating ? (rating / 2) : 0;
                if (normalizedRating < query.ratingMin) return null;
              }

              // Filter by tags/labels if specified
              if (query.tags?.length > 0) {
                const itemLabels = fullItem.metadata?.labels || [];
                const hasMatchingLabel = query.tags.some(tag =>
                  itemLabels.includes(tag.toLowerCase())
                );
                if (!hasMatchingLabel) return null;
              }

              return fullItem;
            }
          }

          // For containers (shows, albums, artists), fetch full metadata to get thumbnails
          if (['show', 'album', 'artist', 'season'].includes(item.type)) {
            const fullItem = await this.getItem(item.ratingKey);
            if (fullItem) return fullItem;
          }

          // Fallback to basic conversion
          return this._toListableItem(item);
        })
      );

      // Filter out nulls and combine with playlists/collections
      const filteredItems = [
        ...matchingPlaylists,
        ...matchingCollections,
        ...convertedItems.filter(Boolean)
      ];

      return {
        items: filteredItems,
        total: filteredItems.length
      };
    } catch (err) {
      console.error('[PlexAdapter] search error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Search playlists by title
   * @param {string} searchText - Text to search for
   * @returns {Promise<ListableItem[]>}
   * @private
   */
  async _searchPlaylists(searchText) {
    try {
      const searchLower = searchText.toLowerCase();
      const data = await this.client.getContainer('/playlists/all');
      const playlists = data.MediaContainer?.Metadata || [];

      return playlists
        .filter(p => p.title?.toLowerCase().includes(searchLower))
        .map(p => new ListableItem({
          id: `plex:${p.ratingKey}`,
          source: 'plex',
          title: p.title,
          itemType: 'container',
          childCount: p.leafCount || 0,
          thumbnail: p.composite ? `${this.proxyPath}${p.composite}` :
                    (p.thumb ? `${this.proxyPath}${p.thumb}` : null),
          metadata: {
            type: 'playlist',
            category: this.#mapTypeToCategory('playlist'),
            playlistType: p.playlistType,
            childCount: p.leafCount || 0,
            smart: p.smart || false
          }
        }));
    } catch (err) {
      console.error('[PlexAdapter] _searchPlaylists error:', err.message);
      return [];
    }
  }

  /**
   * Search collections by title
   * @param {string} searchText - Text to search for
   * @returns {Promise<ListableItem[]>}
   * @private
   */
  async _searchCollections(searchText) {
    try {
      const searchLower = searchText.toLowerCase();

      // Get all library sections to search collections
      const sectionsData = await this.client.getContainer('/library/sections');
      const sections = sectionsData.MediaContainer?.Directory || [];

      const allCollections = [];

      await Promise.all(sections.map(async (section) => {
        try {
          const collectionsData = await this.client.getContainer(
            `/library/sections/${section.key}/collections`
          );
          const collections = collectionsData.MediaContainer?.Metadata || [];

          const matching = collections
            .filter(c => c.title?.toLowerCase().includes(searchLower))
            .map(c => new ListableItem({
              id: `plex:${c.ratingKey}`,
              source: 'plex',
              title: c.title,
              itemType: 'container',
              childCount: c.childCount || 0,
              thumbnail: c.thumb ? `${this.proxyPath}${c.thumb}` : null,
              metadata: {
                type: 'collection',
                category: this.#mapTypeToCategory('collection'),
                librarySectionTitle: section.title,
                childCount: c.childCount || 0
              }
            }));

          allCollections.push(...matching);
        } catch {
          // Skip sections without collections
        }
      }));

      return allCollections;
    } catch (err) {
      console.error('[PlexAdapter] _searchCollections error:', err.message);
      return [];
    }
  }

  /**
   * Get available search capabilities for this adapter.
   * Returns structured capability info for query orchestration.
   * @returns {{canonical: string[], specific: string[]}}
   */
  getSearchCapabilities() {
    return {
      canonical: ['text', 'mediaType', 'tags'],
      specific: ['ratingMin', 'actor', 'director', 'year']
    };
  }

  /**
   * Get canonical → adapter-specific query key mappings.
   * Used by ContentQueryService to translate queries.
   * @returns {Object}
   */
  getQueryMappings() {
    return {
      person: null, // Plex uses actor/director specifically, not generic person
      creator: 'director',
      time: 'year'
    };
  }

  /**
   * Get container alias → internal path mappings.
   * @returns {Object}
   */
  getContainerAliases() {
    return {
      playlists: 'playlist:',
      collections: 'collection:',
      artists: 'artist:',
      albums: 'album:'
    };
  }

  /**
   * Get list of root containers for browsing.
   * @returns {string[]}
   */
  getRootContainers() {
    return ['playlists', 'collections'];
  }
}

export default PlexAdapter;
