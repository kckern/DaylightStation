/**
 * Export Journal Markdown Use Case
 * @module journalist/application/usecases/ExportJournalMarkdown
 * 
 * Exports journal entries as Markdown.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Export journal markdown use case
 */
export class ExportJournalMarkdown {
  #journalEntryRepository;
  #logger;

  constructor(deps) {
    if (!deps.journalEntryRepository) throw new Error('journalEntryRepository is required');

    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} [input.startDate] - Start date (defaults to all time)
   * @returns {Promise<string>} - Markdown string
   */
  async execute(input) {
    const { chatId, startDate } = input;

    this.#logger.debug('export.markdown.start', { chatId, startDate });

    try {
      // 1. Load entries from startDate
      let entries = [];
      if (startDate) {
        const endDate = new Date().toISOString().split('T')[0];
        entries = await this.#journalEntryRepository.findByDateRange(chatId, startDate, endDate);
      } else if (this.#journalEntryRepository.findAll) {
        entries = await this.#journalEntryRepository.findAll(chatId);
      } else {
        // Fallback to recent
        entries = await this.#journalEntryRepository.findRecent?.(chatId, 365) || [];
      }

      if (entries.length === 0) {
        return '# Journal\n\n*No entries found.*\n';
      }

      // 2. Group by date
      const grouped = this.#groupByDate(entries);

      // 3. Format as Markdown
      const markdown = this.#formatAsMarkdown(grouped);

      this.#logger.info('export.markdown.complete', { chatId, entryCount: entries.length });

      return markdown;
    } catch (error) {
      this.#logger.error('export.markdown.error', { chatId, error: error.message });
      throw error;
    }
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

    // Sort by date descending (most recent first)
    return new Map([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  }

  /**
   * Format grouped entries as Markdown
   * @private
   */
  #formatAsMarkdown(grouped) {
    const lines = ['# Journal\n'];

    for (const [date, entries] of grouped) {
      const formattedDate = this.#formatDateForMarkdown(date);
      lines.push(`## ${formattedDate}\n`);

      for (const entry of entries) {
        // Add period indicator if available
        const periodIndicator = entry.period ? `*${entry.period}*: ` : '';
        
        // Format entry text
        const entryText = entry.text.trim();
        
        // Use bullet point for each entry
        lines.push(`* ${periodIndicator}${entryText}\n`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format date for Markdown header
   * @private
   */
  #formatDateForMarkdown(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
}

export default ExportJournalMarkdown;
