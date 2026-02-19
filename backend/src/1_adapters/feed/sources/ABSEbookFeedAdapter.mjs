// backend/src/1_adapters/feed/sources/ABSEbookFeedAdapter.mjs
/**
 * ABSEbookFeedAdapter
 *
 * Fetches random non-fiction ebook chapters from AudioBookShelf.
 * Picks a random book from genre-filtered library items, downloads the
 * EPUB, parses the NCX/NAV table of contents for chapter titles, and
 * returns a random chapter as a feed item.
 *
 * TOC data is cached to disk via DataService to avoid re-downloading EPUBs.
 * Books without a meaningful TOC (< 2 titled chapters) are filtered out.
 *
 * @module adapters/feed/sources/ABSEbookFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
import imageSize from 'image-size';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export class ABSEbookFeedAdapter extends IFeedSourceAdapter {
  #absClient;
  #token;
  #mediaDir;
  #logger;
  #prefetching = false;

  /**
   * @param {Object} deps
   * @param {Object} deps.absClient - AudiobookshelfClient instance
   * @param {string} deps.token - ABS API token for EPUB downloads
   * @param {string} deps.mediaDir - Base media directory for cache storage
   * @param {Object} [deps.logger]
   */
  constructor({ absClient, token, mediaDir, logger = console }) {
    super();
    if (!absClient) throw new Error('ABSEbookFeedAdapter requires absClient');
    if (!token) throw new Error('ABSEbookFeedAdapter requires token');
    if (!mediaDir) throw new Error('ABSEbookFeedAdapter requires mediaDir');
    this.#absClient = absClient;
    this.#token = token;
    this.#mediaDir = mediaDir;
    this.#logger = logger;
  }

  #cachePath(bookId) {
    return path.join(this.#mediaDir, 'archives', 'abs', 'chapters', `${bookId}.yml`);
  }

  #readCache(bookId) {
    try {
      const filePath = this.#cachePath(bookId);
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      return yaml.load(content) || null;
    } catch {
      return null;
    }
  }

  #writeCache(bookId, data) {
    const filePath = this.#cachePath(bookId);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }), 'utf-8');
  }

  get sourceType() { return 'abs-ebooks'; }
  get provides() { return [CONTENT_TYPES.EBOOKS]; }

  /**
   * Fetch feed items from AudioBookShelf.
   *
   * Fetches genre-filtered library items, shuffles them, walks through
   * until finding a book with a meaningful EPUB TOC, and returns a random
   * chapter as a feed card.
   *
   * @param {Object} query - Query config from YAML
   * @param {string} query.params.library - ABS library ID
   * @param {string[]} [query.params.genres] - Genre names to filter by
   * @param {string} _username
   * @returns {Promise<Object[]>} Normalized FeedItem-shaped objects
   */
  async fetchItems(query, _username) {
    const libraryId = query.params?.library;
    if (!libraryId) return [];

    const genres = query.params?.genres || [];

    // ABS API genre filter: base64-encoded genre name
    const filter = genres.length > 0
      ? `genres.${Buffer.from(genres[0]).toString('base64')}`
      : undefined;

    let data;
    try {
      data = await this.#absClient.getLibraryItems(libraryId, {
        limit: 100,
        filter,
      });
    } catch (err) {
      this.#logger.warn?.('abs-ebooks.adapter.list.error', { error: err.message });
      return [];
    }

    const books = data?.results || [];
    if (books.length === 0) return [];

    const itemLimit = query.limit || 1;

    // Shuffle books, then partition into cached (fast) and uncached
    const shuffled = [...books].sort(() => Math.random() - 0.5);
    const cached = [];
    const uncached = [];
    for (const book of shuffled) {
      if (!book.media?.ebookFormat && !book.media?.ebookFile) continue;
      if (this.#readCache(book.id)) {
        cached.push(book);
      } else {
        uncached.push(book);
      }
    }

    const orderedBooks = [...cached, ...uncached];
    const items = [];

    for (const book of orderedBooks) {
      if (items.length >= itemLimit) break;

      const bookId = book.id;
      const metadata = book.media?.metadata || {};

      // Get chapters (cached or parsed from downloaded EPUB)
      const chapterData = await this.#getChapters(bookId, metadata);
      if (!chapterData || !this.#hasMeaningfulToc(chapterData.chapters)) {
        continue;
      }

      const chapters = chapterData.chapters;
      const coverUrl = `/api/v1/proxy/abs/items/${bookId}/cover`;
      const author = metadata.authorName || metadata.author || '';
      const title = metadata.title || 'Untitled';

      // Shuffle chapters and take as many as needed up to the limit
      const shuffledChapters = [...chapters].sort(() => Math.random() - 0.5);
      for (const chapter of shuffledChapters) {
        if (items.length >= itemLimit) break;

        items.push({
          id: `abs-ebooks:${bookId}:${chapter.id}`,
          tier: query.tier || 'library',
          source: 'abs-ebooks',
          title: chapter.title,
          body: chapter.preview || `${author} — ${title}`,
          image: coverUrl,
          link: `${this.#absClient.host}/item/${bookId}`,
          timestamp: new Date().toISOString(),
          priority: query.priority || 5,
          meta: {
            bookId,
            chapterId: chapter.id,
            bookTitle: title,
            author,
            imageWidth: chapterData.coverWidth,
            imageHeight: chapterData.coverHeight,
            sourceName: 'Audiobookshelf',
            sourceIcon: null,
          },
        });
      }
    }

    // Background-prefetch uncached books (fire and forget)
    if (uncached.length > 0) {
      this.#prefetchUncached(uncached).catch(() => {});
    }

    return items;
  }

  async getDetail(localId) {
    const [bookId, chapterIdStr] = localId.split(':');
    const chapterId = parseInt(chapterIdStr, 10);

    const cached = this.#readCache(bookId);
    const chapter = cached?.chapters?.find(ch => ch.id === chapterId);

    if (!chapter?.content) return { sections: [] };

    const html = chapter.content
      .split(/\n\n+/)
      .filter(p => p.trim())
      .map(p => `<p>${p.trim()}</p>`)
      .join('\n');

    return {
      sections: [{
        type: 'article',
        data: { html, wordCount: chapter.content.split(/\s+/).length },
      }],
    };
  }

  /**
   * Get chapter data for a book, using disk cache to avoid re-downloading EPUBs.
   *
   * Cache path: {mediaDir}/archives/abs/chapters/{bookId}.yml
   *
   * @param {string} bookId
   * @param {Object} metadata - Book metadata from list response
   * @returns {Promise<Object|null>} Chapter data
   */
  async #getChapters(bookId, metadata) {
    const cached = this.#readCache(bookId);
    if (cached) return cached;

    // Download EPUB and parse TOC
    let chapters;
    try {
      chapters = await this.#extractEpubToc(bookId);
    } catch (err) {
      this.#logger.warn?.('abs-ebooks.adapter.epub.error', { bookId, error: err.message });
      // Cache empty result to avoid re-attempting failed books
      const emptyData = { bookId, title: metadata.title || '', author: metadata.authorName || '', chapters: [] };
      this.#writeCache(bookId, emptyData);
      return null;
    }

    const { width: coverWidth, height: coverHeight } = await this.#getCoverDimensions(bookId);

    const chapterData = {
      bookId,
      title: metadata.title || '',
      author: metadata.authorName || metadata.author || '',
      coverWidth,
      coverHeight,
      chapters,
    };

    this.#writeCache(bookId, chapterData);
    return chapterData;
  }

  async #getCoverDimensions(bookId) {
    try {
      const host = this.#absClient.host;
      const res = await fetch(`${host}/api/items/${bookId}/cover`, {
        headers: { 'Authorization': `Bearer ${this.#token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { width: 2, height: 3 };
      const buf = Buffer.from(await res.arrayBuffer());
      const dims = imageSize(buf);
      return { width: dims.width, height: dims.height };
    } catch {
      return { width: 2, height: 3 };
    }
  }

  /**
   * Download the EPUB file from ABS and extract chapter titles from the
   * NCX (EPUB 2) or NAV (EPUB 3) table of contents.
   *
   * @param {string} bookId
   * @returns {Promise<Array<{id: number, title: string}>>}
   */
  async #extractEpubToc(bookId) {
    const host = this.#absClient.host;
    const epubResponse = await fetch(`${host}/api/items/${bookId}/ebook`, {
      headers: { 'Authorization': `Bearer ${this.#token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!epubResponse.ok) {
      throw new Error(`Failed to download EPUB: ${epubResponse.status}`);
    }

    const buffer = Buffer.from(await epubResponse.arrayBuffer());

    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(buffer);

    // Try NCX first (EPUB 2), then NAV (EPUB 3)
    let chapters = this.#parseNcx(zip);
    let tocEntry = zip.getEntries().find(e => e.entryName.endsWith('.ncx'));
    if (chapters.length === 0) {
      chapters = this.#parseNav(zip);
      tocEntry = zip.getEntries().find(e =>
        (e.entryName.endsWith('.xhtml') || e.entryName.endsWith('.html')) &&
        e.getData().toString('utf-8').includes('epub:type="toc"')
      );
    }

    const filtered = this.#filterContentChapters(chapters);

    // Extract chapter content from EPUB files
    const basePath = tocEntry ? tocEntry.entryName.replace(/[^/]*$/, '') : '';
    for (const chapter of filtered) {
      if (!chapter.src) continue;
      const text = this.#extractChapterContent(zip, chapter.src, basePath);
      if (text) {
        chapter.content = text;
        chapter.preview = this.#extractPreview(text);
      }
      delete chapter.src;
    }

    return filtered;
  }

  #extractChapterContent(zip, src, basePath) {
    // Strip fragment identifier
    const filePath = src.split('#')[0];
    // Resolve relative to TOC file's directory
    const fullPath = basePath + filePath;
    // Normalize path (handle ../ etc.)
    const normalized = fullPath.split('/').reduce((acc, part) => {
      if (part === '..') acc.pop();
      else if (part !== '.' && part !== '') acc.push(part);
      return acc;
    }, []).join('/');

    const entry = zip.getEntries().find(e => e.entryName === normalized || e.entryName === filePath);
    if (!entry) return null;

    try {
      const html = entry.getData().toString('utf-8');
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\r\n?/g, '\n')
        .replace(/^[^\S\n]+/gm, '')
        .replace(/[^\S\n]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return text || null;
    } catch {
      return null;
    }
  }

  #extractPreview(text) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, 3).join(' ');
  }

  /**
   * Parse NCX (EPUB 2) table of contents.
   * @param {Object} zip - AdmZip instance
   * @returns {Array<{id: number, title: string}>}
   */
  #parseNcx(zip) {
    const ncxEntry = zip.getEntries().find(e => e.entryName.endsWith('.ncx'));
    if (!ncxEntry) return [];

    const content = ncxEntry.getData().toString('utf-8');
    const points = [...content.matchAll(
      /<navPoint[^>]*>[\s\S]*?<text>([^<]+)<\/text>[\s\S]*?<content\s+src=["']([^"']+)["']/g
    )];

    return points.map((m, i) => ({ id: i, title: m[1].trim(), src: m[2] }));
  }

  /**
   * Parse NAV (EPUB 3) table of contents.
   * @param {Object} zip - AdmZip instance
   * @returns {Array<{id: number, title: string}>}
   */
  #parseNav(zip) {
    const entries = zip.getEntries();
    // Find NAV document containing epub:type="toc"
    for (const entry of entries) {
      if (!entry.entryName.endsWith('.xhtml') && !entry.entryName.endsWith('.html')) continue;
      const content = entry.getData().toString('utf-8');
      const tocMatch = content.match(/<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/);
      if (!tocMatch) continue;

      const links = [...tocMatch[1].matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g)];
      return links.map((m, i) => ({ id: i, title: m[2].trim(), src: m[1] }));
    }
    return [];
  }

  /**
   * Filter out front/back matter entries, keeping only content chapters.
   * @param {Array<{id: number, title: string}>} chapters
   * @returns {Array<{id: number, title: string}>}
   */
  #filterContentChapters(chapters) {
    const excluded = /^(cover|title\s*page|dedication|table\s*of\s*contents|contents|about\s*the\s*author|acknowledg[e]?ments?|also\s*by|epigraph|half\s*title|index|bibliography|notes|endnotes|glossary|colophon|foreword|preface|prologue|introduction)$/i;
    const excludedContains = /copyright|appendix/i;

    return chapters.filter(ch => {
      const title = ch.title.trim();
      return title.length > 0 && !excluded.test(title) && !excludedContains.test(title);
    });
  }

  /**
   * Check if a chapters array represents a meaningful TOC.
   * @param {Array} chapters
   * @returns {boolean}
   */
  #hasMeaningfulToc(chapters) {
    if (!Array.isArray(chapters) || chapters.length < 2) return false;
    const titled = chapters.filter(ch => ch.title && ch.title.trim().length > 0);
    return titled.length >= 2;
  }

  async prefetchAll(query, { force = false, onProgress } = {}) {
    const libraryId = query.params?.library;
    if (!libraryId) return { cached: 0, skipped: 0, failed: 0 };

    const genres = query.params?.genres || [];
    const filter = genres.length > 0
      ? `genres.${Buffer.from(genres[0]).toString('base64')}`
      : undefined;

    const data = await this.#absClient.getLibraryItems(libraryId, { limit: 100, filter });
    const books = data?.results || [];

    let cached = 0, skipped = 0, failed = 0;
    for (const book of books) {
      if (!book.media?.ebookFormat && !book.media?.ebookFile) continue;
      const bookId = book.id;
      const metadata = book.media?.metadata || {};

      if (!force && this.#readCache(bookId)) {
        skipped++;
        continue;
      }

      try {
        if (force) {
          const fp = this.#cachePath(bookId);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        await this.#getChapters(bookId, metadata);
        cached++;
        onProgress?.({ bookId, title: metadata.title, current: cached + skipped, total: books.length });
      } catch {
        failed++;
      }
    }

    return { cached, skipped, failed };
  }

  startPrefetchTimer(queryConfigs) {
    const absQueries = queryConfigs.filter(q => q.type === 'abs-ebooks');
    if (absQueries.length === 0) return;

    const run = async () => {
      for (const query of absQueries) {
        try {
          const result = await this.prefetchAll(query);
          this.#logger.debug?.('abs-ebooks.prefetch.complete', result);
        } catch (err) {
          this.#logger.warn?.('abs-ebooks.prefetch.error', { error: err.message });
        }
      }
    };

    // First run after 60s delay, then every 24h
    setTimeout(() => {
      run();
      setInterval(run, 24 * 60 * 60 * 1000);
    }, 60_000);
  }

  async #prefetchUncached(books) {
    if (this.#prefetching) return;
    this.#prefetching = true;
    try {
      for (const book of books) {
        const metadata = book.media?.metadata || {};
        try {
          await this.#getChapters(book.id, metadata);
        } catch {
          // Skip failed books silently — #getChapters already logs
        }
      }
    } finally {
      this.#prefetching = false;
    }
  }
}
