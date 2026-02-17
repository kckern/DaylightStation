// backend/src/1_adapters/feed/sources/JournalFeedAdapter.mjs
/**
 * JournalFeedAdapter
 *
 * Reads recent journal entries from journalist/messages.yml and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/JournalFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class JournalFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('JournalFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'journal'; }

  async fetchItems(query, username) {
    try {
      const data = this.#userDataService.getLifelogData(username, 'journalist', 'messages');
      if (!data?.messages) return [];

      // Filter to user messages only (not bot responses), with meaningful content
      const userMessages = data.messages.filter(msg =>
        msg.senderId !== 'bot' &&
        msg.role !== 'assistant' &&
        msg.content &&
        msg.content.length > 20
      );

      if (userMessages.length === 0) return [];

      // Pick random recent entries (messages are newest-first)
      const limit = query.limit || 2;
      const recent = userMessages.slice(0, 60);
      const shuffled = [...recent].sort(() => Math.random() - 0.5);

      return shuffled.slice(0, limit).map(msg => {
        const ts = msg.timestamp || new Date().toISOString();
        const date = new Date(ts);
        const headline = `Journal Entry for ${date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`;
        const preview = msg.content.length > 140
          ? msg.content.slice(0, 140).replace(/\s+\S*$/, '') + '...'
          : msg.content;
        return {
          id: `journal:${msg.id || ts}`,
          tier: query.tier || 'scrapbook',
          source: 'journal',
          title: headline,
          body: preview,
          image: null,
          link: null,
          timestamp: ts,
          priority: query.priority || 5,
          meta: {
            senderName: msg.senderName,
            sourceName: 'Journal',
            sourceIcon: null,
            fullText: msg.content,
          },
        };
      });
    } catch (err) {
      this.#logger.warn?.('journal.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta) {
    const text = meta?.fullText;
    if (!text) return null;
    return { sections: [{ type: 'body', data: { text } }] };
  }

}
