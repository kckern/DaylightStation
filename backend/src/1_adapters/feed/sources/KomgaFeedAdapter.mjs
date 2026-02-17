// backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs
/**
 * KomgaFeedAdapter
 *
 * Fetches magazine/comic articles from Komga via its REST API.
 * Picks a random series, random recent issue, extracts PDF table-of-contents
 * (bookmarks) via pdfjs-dist, and returns a random article as a feed item.
 *
 * TOC data is cached to disk via DataService to avoid re-downloading PDFs.
 *
 * @module adapters/feed/sources/KomgaFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class KomgaFeedAdapter extends IFeedSourceAdapter {
  #client;
  #apiKey;
  #webUrl;
  #dataService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.client - KomgaClient instance with `.host` property
   * @param {string} deps.apiKey - Komga API key for X-API-Key header
   * @param {string} [deps.webUrl] - Komga web UI base URL for reader links
   * @param {Object} deps.dataService - DataService for TOC cache persistence
   * @param {Object} [deps.logger]
   */
  constructor({ client, apiKey, webUrl = null, dataService, logger = console }) {
    super();
    if (!client) throw new Error('KomgaFeedAdapter requires client');
    if (!apiKey) throw new Error('KomgaFeedAdapter requires apiKey');
    if (!dataService) throw new Error('KomgaFeedAdapter requires dataService');
    this.#client = client;
    this.#apiKey = apiKey;
    this.#webUrl = webUrl ? webUrl.replace(/\/$/, '') : null;
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'komga'; }

  /**
   * Fetch feed items from Komga.
   *
   * Picks a random series from query.params.series, fetches its most recent
   * issues, picks one at random, extracts its TOC, and returns a random
   * article as a feed card.
   *
   * @param {Object} query - Query config from YAML
   * @param {Object[]} query.params.series - Array of {id, label}
   * @param {number} [query.params.recent_issues=6] - How many recent issues to consider
   * @param {string} username
   * @returns {Promise<Object[]>} Normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    const seriesList = query.params?.series;
    if (!Array.isArray(seriesList) || seriesList.length === 0) return [];

    const recentCount = query.params?.recent_issues || 6;
    const items = [];

    // Fetch 1 random article per series (in parallel)
    const results = await Promise.allSettled(
      seriesList.map(series => this.#fetchOneSeries(series, recentCount, query))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value) {
        items.push(results[i].value);
      } else if (results[i].status === 'rejected') {
        this.#logger.warn?.('komga.adapter.series.error', {
          seriesId: seriesList[i].id,
          error: results[i].reason?.message,
        });
      }
    }

    return items;
  }

  /**
   * Fetch a single random article from one series.
   * @param {Object} series - { id, label }
   * @param {number} recentCount - How many recent issues to consider
   * @param {Object} query - Query config for tier/priority
   * @returns {Promise<Object|null>} A single FeedItem or null
   */
  async #fetchOneSeries(series, recentCount, query) {
    const booksUrl = `${this.#client.host}/api/v1/series/${series.id}/books?sort=metadata.numberSort,desc&size=${recentCount}`;
    const booksRes = await fetch(booksUrl, { headers: this.#authHeaders() });
    if (!booksRes.ok) {
      this.#logger.warn?.('komga.adapter.books.error', { status: booksRes.status, seriesId: series.id });
      return null;
    }

    const booksData = await booksRes.json();
    const books = booksData?.content || [];
    if (books.length === 0) return null;

    // Pick a random issue from the recent batch
    const book = books[Math.floor(Math.random() * books.length)];
    const bookId = book.id;
    const bookTitle = book.metadata?.title || book.name || 'Issue';
    const pageCount = book.media?.pagesCount || 0;

    // Extract TOC (cached)
    const toc = await this.#getToc(bookId, series.label, bookTitle, pageCount);

    // Pick a random article from the TOC
    const article = this.#pickArticle(toc, pageCount);
    if (!article) return null;

    const offset = toc.tocPageOffset || 0;
    const pageNum = article.page + offset;
    const imageUrl = `/api/v1/proxy/komga/composite/${bookId}/${pageNum}`;
    const readerLink = this.#webUrl ? `${this.#webUrl}/book/${bookId}/read?page=${pageNum}` : null;

    return {
      id: `komga:${bookId}:${pageNum}`,
      tier: query.tier || 'library',
      source: 'komga',
      title: article.title,
      body: `${series.label} — ${bookTitle}`,
      image: imageUrl,
      link: readerLink,
      timestamp: book.metadata?.releaseDate || book.created || new Date().toISOString(),
      priority: query.priority || 5,
      meta: {
        bookId,
        page: pageNum,
        seriesId: series.id,
        seriesLabel: series.label,
        issueTitle: bookTitle,
        pageCount,
        imageWidth: 1280,
        imageHeight: 720,
        sourceName: 'Komga',
        sourceIcon: null,
      },
    };
  }

  /**
   * Fetch detail view for a Komga item.
   *
   * @param {string} localId - Format: "{bookId}:{page}"
   * @param {Object} meta - Item meta from the scroll response
   * @param {string} username
   * @returns {Promise<{sections: Array}>}
   */
  async getDetail(localId, meta, _username) {
    const colonIdx = localId.lastIndexOf(':');
    const bookId = colonIdx > 0 ? localId.slice(0, colonIdx) : localId;
    const vendorPage = colonIdx > 0 ? parseInt(localId.slice(colonIdx + 1), 10) || 1 : 1;
    const sections = [];

    // Read TOC for offset and article boundaries
    const cachePath = `common/komga/toc/${bookId}.yml`;
    const toc = this.#dataService.household.read(cachePath);
    const offset = toc?.tocPageOffset || 0;

    // Convert vendor page back to printed page for boundary lookup
    const printedPage = vendorPage - offset;

    // Determine article page range from TOC (in printed page numbers)
    const printedEndPage = this.#getArticleEndPage(bookId, printedPage, meta.pageCount || 0);

    // Convert back to vendor pages for image URLs
    const vendorStartPage = printedPage + offset;
    const vendorEndPage = printedEndPage + offset;

    // All article page images (vertically stacked in detail view)
    const images = [];
    for (let p = vendorStartPage; p <= vendorEndPage; p++) {
      images.push({ url: this.#pageImageUrl(bookId, p) });
    }

    sections.push({
      type: 'media',
      data: { images },
    });

    return { sections };
  }

  /**
   * Determine the last page of an article by finding the next TOC entry.
   *
   * @param {string} bookId
   * @param {number} startPage - 1-indexed start page of this article
   * @param {number} totalPages - Total pages in the book
   * @returns {number} Last page of the article (inclusive)
   */
  #getArticleEndPage(bookId, startPage, totalPages) {
    const cachePath = `common/komga/toc/${bookId}.yml`;
    const toc = this.#dataService.household.read(cachePath);

    if (!toc?.articles?.length) {
      // No TOC — show a reasonable number of pages (up to 8)
      return Math.min(startPage + 7, totalPages || startPage);
    }

    // Sort articles by page number
    const sorted = [...toc.articles]
      .map(a => a.page)
      .sort((a, b) => a - b);

    // Find the next article's start page after this one
    const nextPage = sorted.find(p => p > startPage);

    if (nextPage) {
      return nextPage - 1;
    }

    // Last article in the book — go to end of book
    return totalPages || startPage;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build auth headers for Komga API requests.
   * @returns {Object}
   */
  #authHeaders() {
    return {
      'X-API-Key': this.#apiKey,
      'Accept': 'application/json',
    };
  }

  /**
   * Build proxied page image URL.
   * @param {string} bookId
   * @param {number} page - 1-indexed page number
   * @returns {string}
   */
  #pageImageUrl(bookId, page) {
    return `/api/v1/proxy/komga/api/v1/books/${bookId}/pages/${page}`;
  }

  /**
   * Get TOC for a book, using disk cache to avoid re-downloading PDFs.
   *
   * Cache path: household common/komga/toc/{bookId}.yml
   * (Explicit .yml extension to avoid ensureExtension issues with dotted IDs.)
   *
   * @param {string} bookId
   * @param {string} seriesLabel
   * @param {string} issueTitle
   * @param {number} pageCount
   * @returns {Promise<Object>} TOC object with { bookId, series, issue, pages, articles }
   */
  async #getToc(bookId, seriesLabel, issueTitle, pageCount) {
    // Check disk cache
    const cachePath = `common/komga/toc/${bookId}.yml`;
    const cached = this.#dataService.household.read(cachePath);
    if (cached) return cached;

    // Download PDF and extract bookmarks
    let articles = [];
    try {
      articles = await this.#extractBookmarks(bookId);
    } catch (err) {
      this.#logger.warn?.('komga.toc.extract.error', { bookId, error: err.message });
    }

    const tocData = {
      bookId,
      series: seriesLabel,
      issue: issueTitle,
      pages: pageCount,
      articles,
    };

    // Persist to cache
    this.#dataService.household.write(cachePath, tocData);

    return tocData;
  }

  /**
   * Download the book's PDF file from Komga and extract PDF bookmarks
   * (outline / table of contents) using pdfjs-dist.
   *
   * Flattens the outline to max depth 2, skipping container-only entries.
   * Returns array of { title, page } where page is 1-indexed.
   *
   * @param {string} bookId
   * @returns {Promise<Array<{title: string, page: number}>>}
   */
  async #extractBookmarks(bookId) {
    // Download the PDF file
    const fileUrl = `${this.#client.host}/api/v1/books/${bookId}/file`;
    const fileRes = await fetch(fileUrl, {
      headers: { 'X-API-Key': this.#apiKey },
      signal: AbortSignal.timeout(60000),
    });
    if (!fileRes.ok) {
      throw new Error(`Failed to download book file: ${fileRes.status}`);
    }
    const buffer = await fileRes.arrayBuffer();

    // Load with pdfjs-dist (legacy Node build, no worker)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

    let articles = [];
    try {
      const outline = await doc.getOutline();
      if (outline && outline.length > 0) {
        articles = await this.#flattenOutline(doc, outline, 0, 2);
      }
    } finally {
      await doc.destroy();
    }

    return articles;
  }

  /**
   * Recursively flatten a PDF outline to a max depth, resolving each
   * destination to a 1-indexed page number.
   *
   * @param {Object} doc - pdfjs document
   * @param {Object[]} items - Outline items from getOutline()
   * @param {number} depth - Current depth
   * @param {number} maxDepth - Max recursion depth
   * @returns {Promise<Array<{title: string, page: number}>>}
   */
  async #flattenOutline(doc, items, depth, maxDepth) {
    if (!items || depth >= maxDepth) return [];

    const results = [];
    for (const item of items) {
      const hasChildren = item.items && item.items.length > 0;

      // Skip parent/section entries that have children (e.g. "FEATURES", "FRONTIERS")
      // — prefer the more descriptive child entries instead
      if (!hasChildren) {
        const page = await this.#resolveDestination(doc, item.dest);
        if (page !== null) {
          results.push({ title: item.title, page });
        }
      }

      // Recurse into children
      if (hasChildren) {
        const children = await this.#flattenOutline(doc, item.items, depth + 1, maxDepth);
        results.push(...children);
      }
    }

    return results;
  }

  /**
   * Resolve a PDF destination to a 1-indexed page number.
   *
   * Destinations can be:
   *  - An array where dest[0] is a page ref (resolve via getPageIndex)
   *  - A string (named destination, resolve via getDestination first)
   *
   * @param {Object} doc - pdfjs document
   * @param {Array|string|null} dest
   * @returns {Promise<number|null>} 1-indexed page number or null
   */
  async #resolveDestination(doc, dest) {
    try {
      if (!dest) return null;

      let resolved = dest;

      // Named destination: resolve to explicit destination array
      if (typeof dest === 'string') {
        resolved = await doc.getDestination(dest);
        if (!resolved) return null;
      }

      // dest should now be an array; first element is the page ref
      if (Array.isArray(resolved) && resolved.length > 0) {
        const pageIndex = await doc.getPageIndex(resolved[0]); // 0-based
        return pageIndex + 1; // convert to 1-indexed
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Pick a random article from the TOC. If the TOC has no articles,
   * fall back to a random page from the middle 70% of the book.
   *
   * @param {Object} toc - TOC object with articles array and pages count
   * @param {number} pageCount - Total pages in the book
   * @returns {{title: string, page: number}|null}
   */
  #pickArticle(toc, pageCount) {
    const articles = toc?.articles || [];

    if (articles.length > 0) {
      return articles[Math.floor(Math.random() * articles.length)];
    }

    // Fallback: random page from the middle 70%
    if (pageCount <= 0) return null;

    const start = Math.floor(pageCount * 0.15) + 1; // 1-indexed, skip first 15%
    const end = Math.floor(pageCount * 0.85);        // skip last 15%
    if (start >= end) return { title: 'Page', page: 1 };

    const page = start + Math.floor(Math.random() * (end - start));
    return { title: 'Page', page };
  }
}
