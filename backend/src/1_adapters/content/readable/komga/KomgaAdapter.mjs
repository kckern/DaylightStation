// backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { KomgaClient } from './KomgaClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Komga content source adapter.
 * Implements IContentSource for accessing Komga comic/manga server.
 */
export class KomgaAdapter {
  #client;
  #proxyPath;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL
   * @param {string} config.apiKey - Komga API key
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/komga')
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('KomgaAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('KomgaAdapter requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }

    this.#client = new KomgaClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/komga';
  }

  /** @returns {string} */
  get source() {
    return 'komga';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'komga' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^komga:/, '');
  }

  /**
   * Build thumbnail URL for a book
   * @param {string} bookId
   * @returns {string}
   */
  #thumbnailUrl(bookId) {
    return `${this.#proxyPath}/books/${bookId}/thumbnail`;
  }

  /**
   * Build thumbnail URL for a series
   * @param {string} seriesId
   * @returns {string}
   */
  #seriesThumbnailUrl(seriesId) {
    return `${this.#proxyPath}/series/${seriesId}/thumbnail`;
  }

  /**
   * Build thumbnail URL for a library
   * @param {string} libraryId
   * @returns {string}
   */
  #libraryThumbnailUrl(libraryId) {
    return `${this.#proxyPath}/libraries/${libraryId}/thumbnail`;
  }

  /**
   * Create function to generate page URLs for a book
   * Pages are 0-indexed internally but Komga uses 1-indexed
   * @param {string} bookId
   * @returns {Function}
   */
  #createGetPageUrl(bookId) {
    return (page) => `${this.#proxyPath}/books/${bookId}/pages/${page + 1}`;
  }

  /**
   * Normalize format from Komga media profile
   * @param {string} mediaProfile - CBZ, CBR, PDF, etc.
   * @returns {string}
   */
  #normalizeFormat(mediaProfile) {
    return (mediaProfile || 'unknown').toLowerCase();
  }

  /**
   * Normalize reading direction from Komga format
   * @param {string} direction - RIGHT_TO_LEFT, LEFT_TO_RIGHT, etc.
   * @returns {string}
   */
  #normalizeDirection(direction) {
    const map = {
      'RIGHT_TO_LEFT': 'rtl',
      'LEFT_TO_RIGHT': 'ltr',
      'VERTICAL': 'ttb',
      'WEBTOON': 'ttb'
    };
    return map[direction] || 'ltr';
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (komga:book-123)
   * @returns {Promise<ReadableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Handle book ID directly (no prefix)
      const book = await this.#client.getBook(localId);
      if (!book) return null;

      return this.#toReadableItem(book);
    } catch (err) {
      console.error('[KomgaAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string} id - Empty for libraries, lib:xyz for series, series:xyz for books
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Empty = list all libraries
      if (!localId) {
        const libraries = await this.#client.getLibraries();
        return libraries.map(lib => this.#toLibraryListable(lib));
      }

      // Library contents (series)
      if (localId.startsWith('lib:')) {
        const libraryId = localId.replace('lib:', '');
        const result = await this.#client.getSeries(libraryId);
        return (result.content || []).map(series => this.#toSeriesListable(series));
      }

      // Series contents (books)
      if (localId.startsWith('series:')) {
        const seriesId = localId.replace('series:', '');
        const result = await this.#client.getBooks(seriesId);
        return (result.content || []).map(book => this.#toBookListable(book));
      }

      return [];
    } catch (err) {
      console.error('[KomgaAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items - returns empty array for readable content
   * @param {string} id
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id) {
    // Komga content is readable, not playable
    return [];
  }

  /**
   * Resolve to readable items
   * @param {string} id - Book ID
   * @returns {Promise<ReadableItem[]>}
   */
  async resolveReadables(id) {
    try {
      const item = await this.getItem(id);
      if (!item) return [];
      return [item];
    } catch (err) {
      console.error('[KomgaAdapter] resolveReadables error:', err.message);
      return [];
    }
  }

  /**
   * Get storage path for progress persistence
   * @returns {Promise<string>}
   */
  async getStoragePath() {
    return 'komga';
  }

  /**
   * Convert Komga book to ReadableItem
   * @param {Object} book
   * @returns {ReadableItem}
   */
  #toReadableItem(book) {
    const metadata = book.metadata || {};
    const media = book.media || {};
    const readProgress = book.readProgress || {};

    return new ReadableItem({
      id: `komga:${book.id}`,
      source: 'komga',
      title: metadata.title || book.name,
      contentType: 'paged',
      format: this.#normalizeFormat(media.mediaProfile),
      totalPages: media.pagesCount || 0,
      pageLayout: 'single',
      readingDirection: this.#normalizeDirection(metadata.readingDirection),
      _getPageUrl: this.#createGetPageUrl(book.id),
      resumable: true,
      resumePosition: readProgress.page || null,
      thumbnail: this.#thumbnailUrl(book.id),
      description: metadata.summary || null,
      metadata: {
        seriesId: book.seriesId,
        number: metadata.number,
        releaseDate: metadata.releaseDate,
        publisher: metadata.publisher,
        completed: readProgress.completed || false
      }
    });
  }

  /**
   * Convert Komga library to ListableItem
   * @param {Object} library
   * @returns {ListableItem}
   */
  #toLibraryListable(library) {
    return new ListableItem({
      id: `komga:lib:${library.id}`,
      source: 'komga',
      title: library.name,
      itemType: 'container',
      thumbnail: this.#libraryThumbnailUrl(library.id),
      metadata: {
        type: 'library',
        root: library.root
      }
    });
  }

  /**
   * Convert Komga series to ListableItem
   * @param {Object} series
   * @returns {ListableItem}
   */
  #toSeriesListable(series) {
    return new ListableItem({
      id: `komga:series:${series.id}`,
      source: 'komga',
      title: series.name,
      itemType: 'container',
      childCount: series.booksCount || 0,
      thumbnail: this.#seriesThumbnailUrl(series.id),
      metadata: {
        type: 'series',
        libraryId: series.libraryId
      }
    });
  }

  /**
   * Convert Komga book to ListableItem (for browse view)
   * @param {Object} book
   * @returns {ListableItem}
   */
  #toBookListable(book) {
    const metadata = book.metadata || {};
    const media = book.media || {};

    return new ListableItem({
      id: `komga:${book.id}`,
      source: 'komga',
      title: metadata.title || book.name,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(book.id),
      metadata: {
        type: 'book',
        format: this.#normalizeFormat(media.mediaProfile),
        pageCount: media.pagesCount,
        readingDirection: this.#normalizeDirection(metadata.readingDirection)
      }
    });
  }
}

export default KomgaAdapter;
