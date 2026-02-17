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
        typeof msg.content === 'string' &&
        msg.content.trim().length > 20
      );

      if (userMessages.length === 0) return [];

      // Pick random recent entries (messages are newest-first)
      const limit = query.limit || 2;
      const recent = userMessages.slice(0, 60);
      const shuffled = [...recent].sort(() => Math.random() - 0.5);

      return shuffled.slice(0, limit).map(msg => {
        const ts = msg.timestamp || new Date().toISOString();
        const date = new Date(ts);
        const dateTitle = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        return {
          id: `journal:${msg.id || ts}`,
          tier: query.tier || 'scrapbook',
          source: 'journal',
          title: dateTitle,
          body: msg.content.trim(),
          image: null,
          link: null,
          timestamp: ts,
          priority: query.priority || 5,
          meta: {
            senderId: msg.senderId || username,
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

  async getDetail(localId, meta, username) {
    const text = meta?.fullText;
    if (!text) return null;

    const sections = [{ type: 'body', data: { text } }];

    // Build timeline of neighboring entries
    if (username) {
      try {
        const timeline = this.#buildTimeline(localId, username);
        if (timeline.length > 0) {
          sections.push({ type: 'timeline', data: { items: timeline, label: 'Journal Entries' } });
        }
      } catch (err) {
        this.#logger.warn?.('journal.timeline.error', { error: err.message });
      }
    }

    return { sections };
  }

  #buildTimeline(localId, username) {
    const data = this.#userDataService.getLifelogData(username, 'journalist', 'messages');
    if (!data?.messages) return [];

    const userMessages = data.messages.filter(msg =>
      msg.senderId !== 'bot' &&
      msg.role !== 'assistant' &&
      typeof msg.content === 'string' &&
      msg.content.trim().length > 20
    );

    // Messages are newest-first; reverse to chronological order
    const chronological = [...userMessages].reverse();

    const currentIdx = chronological.findIndex(msg => {
      const msgId = String(msg.id || msg.timestamp);
      return msgId === localId;
    });

    if (currentIdx === -1) return [];

    const start = Math.max(0, currentIdx - 5);
    const end = Math.min(chronological.length, currentIdx + 6);
    const window = chronological.slice(start, end);

    return window.map(msg => {
      const ts = msg.timestamp || new Date().toISOString();
      const msgId = String(msg.id || ts);
      const date = new Date(ts);
      const title = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const preview = msg.content.trim().length > 120
        ? msg.content.trim().slice(0, 120) + '...'
        : msg.content.trim();

      return {
        id: `journal:${msgId}`,
        source: 'journal',
        title,
        body: preview,
        preview,
        timestamp: ts,
        isCurrent: msgId === localId,
        meta: {
          senderId: msg.senderId || username,
          senderName: msg.senderName,
          sourceName: 'Journal',
          sourceIcon: null,
          fullText: msg.content,
        },
      };
    });
  }

}
