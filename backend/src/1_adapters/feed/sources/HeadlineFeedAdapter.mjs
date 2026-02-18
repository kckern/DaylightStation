// backend/src/1_adapters/feed/sources/HeadlineFeedAdapter.mjs
/**
 * HeadlineFeedAdapter
 *
 * Fetches headline items from HeadlineService and normalizes them to FeedItem shape.
 * Supports offset-based pagination.
 *
 * Extracted from FeedPoolManager#fetchHeadlinesPage() to follow the standard
 * IFeedSourceAdapter pattern.
 *
 * @module adapters/feed/sources/HeadlineFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

export class HeadlineFeedAdapter extends IFeedSourceAdapter {
  #headlineService;
  #logger;

  constructor({ headlineService, logger = console }) {
    super();
    this.#headlineService = headlineService;
    this.#logger = logger;
  }

  get sourceType() { return 'headlines'; }
  get provides() { return [CONTENT_TYPES.NEWS]; }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#headlineService) return { items: [], cursor: null };
    const pages = this.#headlineService.getPageList(username);
    if (!pages.length) return { items: [], cursor: null };

    const totalLimit = query.limit || 30;
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const allItems = [];

    for (const page of pages) {
      const result = await this.#headlineService.getAllHeadlines(username, page.id);
      if (!result?.sources) continue;

      for (const [sourceId, source] of Object.entries(result.sources)) {
        for (const item of (source.items || [])) {
          allItems.push({
            id: `headline:${item.id || sourceId + ':' + item.link}`,
            tier: query.tier || 'wire',
            source: 'headlines',
            title: item.title,
            body: item.desc || null,
            image: item.image || null,
            link: item.link,
            timestamp: item.timestamp || new Date().toISOString(),
            priority: query.priority || 0,
            meta: {
              sourceId,
              sourceLabel: source.label,
              sourceName: source.label || sourceId,
              sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
              paywall: source.paywall || false,
              paywallProxy: source.paywall ? result.paywallProxy : null,
              ...(item.imageWidth && item.imageHeight
                ? { imageWidth: item.imageWidth, imageHeight: item.imageHeight }
                : {}),
            },
          });
        }
      }
    }

    allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const page = allItems.slice(offset, offset + totalLimit);

    // Probe dimensions for items with images but no dims from the service
    await Promise.all(page.map(async item => {
      if (item.image && !item.meta?.imageWidth) {
        const dims = await probeImageDimensions(item.image);
        if (dims) {
          item.meta.imageWidth = dims.width;
          item.meta.imageHeight = dims.height;
        }
      }
    }));

    const nextOffset = offset + totalLimit;
    const hasMore = nextOffset < allItems.length;
    return { items: page, cursor: hasMore ? String(nextOffset) : null };
  }
}
