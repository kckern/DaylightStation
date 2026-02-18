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

      // Group all messages by calendar day (YYYY-MM-DD)
      const dayMap = this.#groupByDay(data.messages);
      const dayKeys = Object.keys(dayMap);
      if (dayKeys.length === 0) return [];

      // Pick random days
      const limit = query.limit || 1;
      const shuffled = [...dayKeys].sort(() => Math.random() - 0.5);

      return shuffled.slice(0, limit).map(dayKey => {
        const msgs = dayMap[dayKey];
        const firstTs = msgs[0].timestamp || new Date().toISOString();
        const date = new Date(firstTs);
        const dateTitle = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        // Build conversation body from all messages that day
        const convoLines = msgs.map(msg => {
          const sender = (msg.senderId === 'bot' || msg.role === 'assistant') ? 'Journalist' : (msg.senderName || username);
          return `**${sender}:** ${(msg.content || '').trim()}`;
        }).filter(line => line.length > 0);

        // Use first user message as preview
        const firstUserMsg = msgs.find(msg =>
          msg.senderId !== 'bot' && msg.role !== 'assistant' &&
          typeof msg.content === 'string' && msg.content.trim().length > 0
        );
        const preview = firstUserMsg?.content.trim() || convoLines[0] || '';

        return {
          id: `journal:${dayKey}`,
          tier: query.tier || 'scrapbook',
          source: 'journal',
          title: dateTitle,
          body: preview.length > 200 ? preview.slice(0, 200) + '...' : preview,
          image: null,
          link: null,
          timestamp: firstTs,
          priority: query.priority || 5,
          meta: {
            sourceName: 'Journal',
            sourceIcon: null,
            dayKey,
            fullConversation: convoLines.join('\n\n'),
          },
        };
      });
    } catch (err) {
      this.#logger.warn?.('journal.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, username) {
    const convo = meta?.fullConversation;
    if (!convo) return null;

    const sections = [{ type: 'body', data: { text: convo } }];

    // Build timeline of neighboring days
    if (username && meta?.dayKey) {
      try {
        const timeline = this.#buildTimeline(meta.dayKey, username);
        if (timeline.length > 0) {
          sections.push({ type: 'timeline', data: { items: timeline, label: 'Journal Entries' } });
        }
      } catch (err) {
        this.#logger.warn?.('journal.timeline.error', { error: err.message });
      }
    }

    return { sections };
  }

  #groupByDay(messages) {
    const dayMap = {};
    for (const msg of messages) {
      if (typeof msg.content !== 'string' || msg.content.trim().length === 0) continue;
      const ts = msg.timestamp || new Date().toISOString();
      const dayKey = ts.slice(0, 10); // YYYY-MM-DD
      if (!dayMap[dayKey]) dayMap[dayKey] = [];
      dayMap[dayKey].push(msg);
    }
    // Sort each day's messages chronologically
    for (const day of Object.values(dayMap)) {
      day.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
    return dayMap;
  }

  #buildTimeline(currentDayKey, username) {
    const data = this.#userDataService.getLifelogData(username, 'journalist', 'messages');
    if (!data?.messages) return [];

    const dayMap = this.#groupByDay(data.messages);
    const dayKeys = Object.keys(dayMap).sort(); // chronological

    const currentIdx = dayKeys.indexOf(currentDayKey);
    if (currentIdx === -1) return [];

    const start = Math.max(0, currentIdx - 5);
    const end = Math.min(dayKeys.length, currentIdx + 6);

    return dayKeys.slice(start, end).map(dayKey => {
      const msgs = dayMap[dayKey];
      const firstTs = msgs[0].timestamp || new Date().toISOString();
      const date = new Date(firstTs);
      const title = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

      const firstUserMsg = msgs.find(msg =>
        msg.senderId !== 'bot' && msg.role !== 'assistant'
      );
      const preview = (firstUserMsg?.content || msgs[0].content || '').trim();

      return {
        id: `journal:${dayKey}`,
        source: 'journal',
        title,
        body: preview.length > 120 ? preview.slice(0, 120) + '...' : preview,
        preview: preview.length > 120 ? preview.slice(0, 120) + '...' : preview,
        timestamp: firstTs,
        isCurrent: dayKey === currentDayKey,
        meta: {
          sourceName: 'Journal',
          sourceIcon: null,
          dayKey,
          fullConversation: msgs.map(msg => {
            const sender = (msg.senderId === 'bot' || msg.role === 'assistant') ? 'Journalist' : (msg.senderName || username);
            return `**${sender}:** ${(msg.content || '').trim()}`;
          }).join('\n\n'),
        },
      };
    });
  }

}
