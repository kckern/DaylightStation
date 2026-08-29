/** Builds the vendor-neutral Reader timeline projection used by Feed. */
export class FeedReaderTimelineService {
  constructor({ reader, content, state = null } = {}) {
    this.reader = reader;
    this.content = content;
    this.state = state;
  }

  async getTimeline(username, {
    feedIds = [], count = null, continuation = null, excludeRead = false, days = 3,
  } = {}) {
    this.state?.ensureHistoryBackfill(username);
    const filtered = feedIds.length > 0;
    const streamId = filtered && feedIds.length === 1
      ? feedIds[0]
      : 'user/-/state/com.google/reading-list';
    const fetchCount = count ?? (filtered ? 50 : 200);
    const [{ items, continuation: freshContinuation }, allFeeds] = await Promise.all([
      this.reader.getItems(streamId, username, { count: fetchCount, continuation, excludeRead }),
      this.reader.getFeeds(username),
    ]);

    const feedUrlById = new Map();
    for (const feed of allFeeds) {
      if (feed.id && feed.url) feedUrlById.set(feed.id, feed.url);
    }
    const readTag = 'user/-/state/com.google/read';
    let result = items.map((item) => {
      const feedUrl = feedUrlById.get(item.feedId) || null;
      const articleUrl = item.canonical?.[0]?.href || item.alternate?.[0]?.href || null;
      return {
        ...item,
        isRead: (item.categories || []).some((category) => category === readTag),
        preview: (item.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        tags: (item.categories || []).filter((category) => category.includes('/label/'))
          .map((category) => category.split('/label/').pop()),
        iconUrl: this.content.resolveIconPath(feedUrl, articleUrl),
      };
    });

    if (filtered && feedIds.length > 1) {
      const selected = new Set(feedIds);
      result = result.filter((item) => selected.has(item.feedId));
    }

    let nextContinuation = freshContinuation;
    let exhausted = !freshContinuation && items.length < fetchCount;
    if (!filtered) {
      result.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
      const dayKey = (date) => (date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'unknown');
      const distinctDays = new Set();
      const trimmed = [];
      for (const item of result) {
        const key = dayKey(item.published ? new Date(item.published) : null);
        if (distinctDays.size < days || distinctDays.has(key)) {
          distinctDays.add(key);
          trimmed.push(item);
        } else break;
      }
      if (trimmed.length < result.length && trimmed.length > 0) {
        const oldest = trimmed.at(-1);
        if (oldest?.published) nextContinuation = String(Math.floor(new Date(oldest.published).getTime() * 1000));
        exhausted = false;
      }
      result = trimmed;
    }

    this.reader.enrich(result);
    return {
      items: this.state ? this.state.enrich(username, result, 'reader') : result,
      continuation: nextContinuation,
      exhausted,
    };
  }
}

export default FeedReaderTimelineService;
