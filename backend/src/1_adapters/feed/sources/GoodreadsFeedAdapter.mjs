/**
 * GoodreadsFeedAdapter
 *
 * Reads books from lifelog (harvested by GoodreadsHarvester) and returns
 * random books as scrapbook-tier FeedItems with cover images.
 *
 * @module adapters/feed/sources/GoodreadsFeedAdapter
 */

import imageSize from 'image-size';
import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class GoodreadsFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('GoodreadsFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'goodreads'; }

  async #getImageDimensions(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return {};
      const buf = Buffer.from(await res.arrayBuffer());
      const dims = imageSize(buf);
      return { imageWidth: dims.width, imageHeight: dims.height };
    } catch {
      return {};
    }
  }

  async fetchItems(query, username) {
    try {
      const books = this.#userDataService.getLifelogData(username, 'goodreads');
      if (!Array.isArray(books) || books.length === 0) return [];

      const limit = query.limit || 2;
      const shuffled = [...books].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, limit);

      const items = await Promise.all(selected.map(async book => {
        const ts = book.readAt
          ? new Date(book.readAt).toISOString()
          : new Date().toISOString();

        const imageUrl = book.coverImage?.replace(/\.(_S[XY]\d+)+_\./, '.') || null;
        const dims = imageUrl ? await this.#getImageDimensions(imageUrl) : {};

        return {
          id: `goodreads:${book.bookId || book.title}`,
          tier: query.tier || 'scrapbook',
          source: 'goodreads',
          title: book.title || 'Unknown Book',
          body: book.author || '',
          image: imageUrl,
          link: book.bookId ? `https://www.goodreads.com/book/show/${book.bookId}` : null,
          timestamp: ts,
          priority: query.priority || 5,
          meta: {
            sourceName: 'Goodreads',
            sourceIcon: 'https://www.goodreads.com',
            author: book.author,
            rating: book.rating,
            review: book.review,
            readAt: book.readAt,
            ...dims,
          },
        };
      }));

      return items;
    } catch (err) {
      this.#logger.warn?.('goodreads.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    const sections = [];

    // Book metadata line (author, rating, read date)
    const parts = [];
    if (meta?.author) parts.push(meta.author);
    if (meta?.rating) {
      const stars = Array.from({ length: 5 }, (_, i) => i < meta.rating ? '\u2605' : '\u2606').join('');
      parts.push(stars);
    }
    if (meta?.readAt) {
      const d = new Date(meta.readAt);
      parts.push(`Read ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`);
    }
    if (parts.length > 0) {
      sections.push({ type: 'body', data: { text: parts.join('  \u00b7  ') } });
    }

    // Review as body section
    if (meta?.review) {
      sections.push({ type: 'body', data: { text: meta.review } });
    }

    if (sections.length === 0) return null;
    return { sections };
  }
}
