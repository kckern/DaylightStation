/**
 * Review Journal Entries Use Case
 * @module journalist/usecases/ReviewJournalEntries
 *
 * Shows a review/summary of recent journal entries.
 */

/**
 * Review journal entries use case
 */
export class ReviewJournalEntries {
  #messagingGateway;
  #journalEntryRepository;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} [input.startDate] - Start date (defaults to 7 days ago)
   * @param {string} [input.endDate] - End date (defaults to today)
   */
  async execute(input) {
    const { chatId, startDate, endDate } = input;

    this.#logger.debug?.('review.entries.start', { chatId, startDate, endDate });

    try {
      // 1. Calculate date range
      const end = endDate || nowDate();
      const start = startDate || this.#getDateDaysAgo(7);

      // 2. Load entries for date range
      let entries = [];
      if (this.#journalEntryRepository?.findByDateRange) {
        entries = await this.#journalEntryRepository.findByDateRange(chatId, start, end);
      } else if (this.#journalEntryRepository?.findRecent) {
        entries = await this.#journalEntryRepository.findRecent(chatId, 7);
      }

      if (entries.length === 0) {
        await this.#messagingGateway.sendMessage(
          chatId,
          '📖 No journal entries found for this period. Start journaling to see your entries here!',
          {},
        );
        return { success: true, entryCount: 0 };
      }

      // 3. Group by date
      const grouped = this.#groupByDate(entries);

      // 4. Build review message
      const message = this.#buildReviewMessage(grouped);

      // 5. Send message
      const { messageId } = await this.#messagingGateway.sendMessage(chatId, message, {
        parseMode: 'HTML',
      });

      this.#logger.info?.('review.entries.complete', { chatId, entryCount: entries.length });

      return {
        success: true,
        messageId,
        entryCount: entries.length,
        dateRange: { start, end },
      };
    } catch (error) {
      this.#logger.error?.('review.entries.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Get date N days ago
   * @private
   */
  #getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Group entries by date
   * @private
   */
  #groupByDate(entries) {
    const groups = new Map();

    for (const entry of entries) {
      const date = entry.date || entry.createdAt?.split('T')[0];
      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date).push(entry);
    }

    // Sort by date descending
    return new Map([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  }

  /**
   * Build review message
   * @private
   */
  #buildReviewMessage(grouped) {
    const lines = ['📖 <b>Journal Review</b>\n'];

    for (const [date, entries] of grouped) {
      const formattedDate = this.#formatDate(date);
      lines.push(`\n<b>${formattedDate}</b>`);

      for (const entry of entries) {
        const preview = this.#truncateText(entry.text, 100);
        const periodEmoji = this.#getPeriodEmoji(entry.period);
        lines.push(`${periodEmoji} ${preview}`);
      }
    }

    lines.push(`\n<i>${this.#getTotalEntryCount(grouped)} entries total</i>`);

    return lines.join('\n');
  }

  /**
   * Format date for display
   * @private
   */
  #formatDate(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Truncate text
   * @private
   */
  #truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Get emoji for period
   * @private
   */
  #getPeriodEmoji(period) {
    const emojis = {
      morning: '🌅',
      afternoon: '☀️',
      evening: '🌆',
      night: '🌙',
    };
    return emojis[period] || '📝';
  }

  /**
   * Get total entry count from grouped
   * @private
   */
  #getTotalEntryCount(grouped) {
    let count = 0;
    for (const entries of grouped.values()) {
      count += entries.length;
    }
    return count;
  }
}

export default ReviewJournalEntries;
