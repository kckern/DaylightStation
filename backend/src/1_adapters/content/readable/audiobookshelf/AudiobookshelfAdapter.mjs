// backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { AudiobookshelfClient } from './AudiobookshelfClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Audiobookshelf content source adapter.
 * Implements IContentSource for accessing Audiobookshelf ebook/audiobook server.
 *
 * Supports both ebooks (ReadableItem) and audiobooks (PlayableItem).
 */
export class AudiobookshelfAdapter {
  #client;
  #proxyPath;

  /**
   * @param {Object} config
   * @param {string} config.host - Audiobookshelf server URL
   * @param {string} config.token - Audiobookshelf API token
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/abs')
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AudiobookshelfAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.token) {
      throw new InfrastructureError('AudiobookshelfAdapter requires token', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'token'
      });
    }

    this.#client = new AudiobookshelfClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/abs';
  }

  /** @returns {string} */
  get source() {
    return 'abs';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'abs' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^abs:/, '');
  }

  /**
   * Build cover URL for an item
   * @param {string} itemId
   * @returns {string}
   */
  #coverUrl(itemId) {
    return `${this.#proxyPath}/items/${itemId}/cover`;
  }

  /**
   * Build audio stream URL for an audiobook
   * ABS uses /api/items/{itemId}/file/{ino} for audio streaming
   * @param {string} itemId
   * @param {string} [ino] - Audio file inode from item.media.audioFiles[0].ino
   * @returns {string}
   */
  #audioUrl(itemId, ino) {
    if (ino) {
      return `${this.#proxyPath}/items/${itemId}/file/${ino}`;
    }
    // Fallback for compatibility (won't work for streaming)
    return `${this.#proxyPath}/items/${itemId}/play`;
  }

  /**
   * Build ebook content URL
   * @param {string} itemId
   * @returns {string}
   */
  #ebookUrl(itemId) {
    return `${this.#proxyPath}/items/${itemId}/ebook`;
  }

  /**
   * Check if item data represents an ebook
   * @param {Object} item
   * @returns {boolean}
   */
  #isEbook(item) {
    return Boolean(item?.media?.ebookFile);
  }

  /**
   * Check if item data represents an audiobook
   * @param {Object} item
   * @returns {boolean}
   */
  #isAudiobook(item) {
    // Check both numAudioFiles (list response) and audioFiles array (detail response)
    const numFiles = item?.media?.numAudioFiles ?? item?.media?.audioFiles?.length ?? 0;
    return numFiles > 0;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (abs:item-123)
   * @returns {Promise<ReadableItem|PlayableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);
      const item = await this.#client.getItem(localId);
      if (!item) return null;

      // Get progress for resume position
      let progress = null;
      try {
        progress = await this.#client.getProgress(localId);
      } catch {
        // Progress may not exist, that's okay
      }

      // Return appropriate item type based on content
      if (this.#isEbook(item)) {
        return this.#toReadableItem(item, progress);
      } else if (this.#isAudiobook(item)) {
        return this.#toPlayableItem(item, progress);
      }

      return null;
    } catch (err) {
      console.error('[AudiobookshelfAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string} id - Empty for libraries, lib:xyz for items in library
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Empty = list all libraries
      if (!localId) {
        const data = await this.#client.getLibraries();
        const libraries = data.libraries || [];
        return libraries.map(lib => this.#toLibraryListable(lib));
      }

      // Library contents (items)
      if (localId.startsWith('lib:')) {
        const libraryId = localId.replace('lib:', '');
        const data = await this.#client.getLibraryItems(libraryId);
        const items = data.results || [];
        return items.map(item => this.#toItemListable(item));
      }

      return [];
    } catch (err) {
      console.error('[AudiobookshelfAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items
   * @param {string} id - Item ID
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      const item = await this.getItem(id);
      if (!item) return [];

      // Only return if it's a PlayableItem (audiobook)
      if (typeof item.isPlayable === 'function' && item.isPlayable()) {
        return [item];
      }
      return [];
    } catch (err) {
      console.error('[AudiobookshelfAdapter] resolvePlayables error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to readable items
   * @param {string} id - Item ID
   * @returns {Promise<ReadableItem[]>}
   */
  async resolveReadables(id) {
    try {
      const item = await this.getItem(id);
      if (!item) return [];

      // Only return if it's a ReadableItem (ebook)
      if (typeof item.isReadable === 'function' && item.isReadable()) {
        return [item];
      }
      return [];
    } catch (err) {
      console.error('[AudiobookshelfAdapter] resolveReadables error:', err.message);
      return [];
    }
  }

  /**
   * Get storage path for progress persistence
   * @returns {Promise<string>}
   */
  async getStoragePath() {
    return 'abs';
  }

  /**
   * Search for media items (implements IMediaSearchable)
   * @param {Object} query - MediaSearchQuery
   * @param {string} [query.mediaType] - Filter by 'audio' (audiobooks) or 'ebook'
   * @param {string} [query.text] - Text search (searches title)
   * @param {number} [query.take=20] - Max items to return
   * @param {number} [query.skip=0] - Items to skip
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query = {}) {
    try {
      const { mediaType, text, take = 20, skip = 0 } = query;

      // Get all libraries first
      const librariesData = await this.#client.getLibraries();
      const libraries = librariesData.libraries || [];

      const allItems = [];

      // Fetch items from each library
      for (const lib of libraries) {
        const itemsData = await this.#client.getLibraryItems(lib.id, 0, 100);
        const items = itemsData.results || [];

        for (const item of items) {
          // Filter by mediaType if specified
          const isAudiobook = this.#isAudiobook(item);
          const isEbook = this.#isEbook(item);

          if (mediaType === 'audio' && !isAudiobook) continue;
          if (mediaType === 'ebook' && !isEbook) continue;

          // Filter by text if specified (simple title search)
          if (text) {
            const title = item.media?.metadata?.title?.toLowerCase() || '';
            if (!title.includes(text.toLowerCase())) continue;
          }

          // Convert to appropriate item type
          if (isAudiobook) {
            allItems.push(this.#toPlayableItem(item, null));
          } else if (isEbook) {
            allItems.push(this.#toReadableItem(item, null));
          }
        }
      }

      // Apply pagination
      const paginatedItems = allItems.slice(skip, skip + take);

      return {
        items: paginatedItems,
        total: allItems.length
      };
    } catch (err) {
      console.error('[AudiobookshelfAdapter] search error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Get available search capabilities (implements IMediaSearchable)
   * @returns {string[]} - Supported query fields
   */
  getSearchCapabilities() {
    return ['text', 'mediaType', 'take', 'skip'];
  }

  /**
   * Convert Audiobookshelf item to ReadableItem (for ebooks)
   * @param {Object} item
   * @param {Object} [progress]
   * @returns {ReadableItem}
   */
  #toReadableItem(item, progress) {
    const media = item.media || {};
    const ebookFile = media.ebookFile || {};
    const metadata = media.metadata || ebookFile.metadata || {};

    // Build FlowPosition object with CFI for epub.js reader integration
    // ebookLocation is the EPUB CFI string (e.g., "/6/14!/4/2/1:0")
    // ebookProgress is 0-1 fraction, convert to 0-100 percent
    const resumePosition = progress?.ebookLocation ? {
      type: 'flow',
      cfi: progress.ebookLocation,
      percent: Math.round((progress.ebookProgress || 0) * 100)
    } : (progress?.ebookProgress != null ? {
      type: 'flow',
      cfi: null,
      percent: Math.round(progress.ebookProgress * 100)
    } : null);

    return new ReadableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: metadata.title || item.id,
      contentType: 'flow',
      format: (ebookFile.ebookFormat || 'epub').toLowerCase(),
      contentUrl: this.#ebookUrl(item.id),
      resumable: true,
      resumePosition,
      thumbnail: this.#coverUrl(item.id),
      description: metadata.description || null,
      metadata: {
        libraryId: item.libraryId,
        author: metadata.authorName || metadata.author,
        narrator: metadata.narratorName,
        completed: progress?.isFinished || false
      }
    });
  }

  /**
   * Convert Audiobookshelf item to PlayableItem (for audiobooks)
   * @param {Object} item
   * @param {Object} [progress]
   * @returns {PlayableItem}
   */
  #toPlayableItem(item, progress) {
    const media = item.media || {};
    const metadata = media.metadata || {};

    const author = metadata.authorName || metadata.author || null;
    // Get first audio file's ino for streaming URL
    const firstAudioFile = media.audioFiles?.[0];
    const audioIno = firstAudioFile?.ino;

    return new PlayableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: metadata.title || item.id,
      mediaType: 'audio',
      mediaUrl: this.#audioUrl(item.id, audioIno),
      duration: media.duration || null,
      resumable: true,
      resumePosition: progress?.currentTime || null,
      thumbnail: this.#coverUrl(item.id),
      description: metadata.description || null,
      metadata: {
        libraryId: item.libraryId,
        author,
        // Alias for AudioPlayer frontend compatibility (looks for metadata.artist)
        artist: author,
        narrator: metadata.narratorName,
        // Alias for AudioPlayer (looks for metadata.albumArtist for narrator display)
        albumArtist: metadata.narratorName,
        // Series name as album for display
        album: metadata.seriesName || null,
        numAudioFiles: media.numAudioFiles,
        completed: progress?.isFinished || false
      }
    });
  }

  /**
   * Convert Audiobookshelf library to ListableItem
   * @param {Object} library
   * @returns {ListableItem}
   */
  #toLibraryListable(library) {
    return new ListableItem({
      id: `abs:lib:${library.id}`,
      source: 'abs',
      title: library.name,
      itemType: 'container',
      thumbnail: null, // Libraries don't have thumbnails
      metadata: {
        type: 'library',
        mediaType: library.mediaType
      }
    });
  }

  /**
   * Convert Audiobookshelf item to ListableItem (for browse view)
   * @param {Object} item
   * @returns {ListableItem}
   */
  #toItemListable(item) {
    const media = item.media || {};
    const metadata = media.metadata || {};

    return new ListableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: metadata.title || item.id,
      itemType: 'leaf',
      thumbnail: this.#coverUrl(item.id),
      metadata: {
        type: this.#isEbook(item) ? 'ebook' : 'audiobook',
        author: metadata.authorName || metadata.author,
        duration: media.duration,
        numAudioFiles: media.numAudioFiles
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
      canonical: ['text', 'creator'],
      specific: ['narrator', 'author', 'series']
    };
  }

  /**
   * Get canonical → adapter-specific query key mappings.
   * Used by ContentQueryService to translate queries.
   * @returns {Object}
   */
  getQueryMappings() {
    return {
      person: 'narrator', // Best effort: person → narrator for audiobooks
      creator: 'author'
    };
  }

  /**
   * Get container alias → internal path mappings.
   * @returns {Object}
   */
  getContainerAliases() {
    return {
      libraries: 'lib:',
      authors: 'author:',
      narrators: 'narrator:',
      series: 'series:'
    };
  }

  /**
   * Get list of root containers for browsing.
   * @returns {string[]}
   */
  getRootContainers() {
    return ['libraries', 'authors', 'series'];
  }
}

export default AudiobookshelfAdapter;
