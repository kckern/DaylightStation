/**
 * Application facade for reader access, enrichment, and durable dismissal.
 * HTTP concerns stay in the router; adapter selection and persistence live here.
 */
export class FeedReaderService {
  constructor({ readerGateway, sourceAdapters = [], dismissedItemsStore = null, contentPluginRegistry = null, logger = console }) {
    this.readerGateway = readerGateway;
    this.dismissedItemsStore = dismissedItemsStore;
    this.contentPluginRegistry = contentPluginRegistry;
    this.logger = logger;
    this.markReadSources = new Map();
    for (const source of sourceAdapters) {
      if (source.sourceType && source.supportsMarkRead === true) this.markReadSources.set(source.sourceType, source);
    }
  }

  getCategories(username) { return this.readerGateway.getCategories(username); }
  getFeeds(username) { return this.readerGateway.getFeeds(username); }
  getItems(feed, username, options) { return this.readerGateway.getItems(feed, username, options); }

  async markItems(itemIds, username, action) {
    if (action === 'read') return this.readerGateway.markRead(itemIds, username);
    if (action === 'unread') return this.readerGateway.markUnread(itemIds, username);
    return null;
  }

  enrich(items) {
    this.contentPluginRegistry?.enrich(items);
    return items;
  }

  async dismiss(itemIds, username) {
    const bySource = new Map();
    const otherIds = [];
    for (const id of itemIds) {
      const colonIndex = id.indexOf(':');
      const sourceType = colonIndex > 0 ? id.slice(0, colonIndex) : null;
      if (sourceType && this.markReadSources.has(sourceType)) {
        if (!bySource.has(sourceType)) bySource.set(sourceType, []);
        bySource.get(sourceType).push(id);
      } else {
        otherIds.push(id);
      }
    }

    let dismissed = 0;
    const failed = [];
    await Promise.all([...bySource].map(async ([sourceType, ids]) => {
      try {
        await this.markReadSources.get(sourceType).markRead(ids, username);
        dismissed += ids.length;
      } catch (error) {
        this.logger.warn?.('feed.dismiss.adapter.error', { sourceType, error: error.message, count: ids.length });
        failed.push(...ids);
      }
    }));

    if (otherIds.length > 0 && this.dismissedItemsStore) {
      await this.dismissedItemsStore.add(otherIds);
      dismissed += otherIds.length;
    } else if (otherIds.length > 0) {
      failed.push(...otherIds);
    }
    return { dismissed, failed };
  }
}

export default FeedReaderService;
