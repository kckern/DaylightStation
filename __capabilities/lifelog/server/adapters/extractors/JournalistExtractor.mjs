/**
 * Journalist Messages Lifelog Extractor
 *
 * Extracts journal entries and conversations from journalist/messages.yml
 * These are the user's own voice notes and text entries about their day
 *
 * @module applications/lifelog/extractors
 */

import moment from 'moment';
import { ILifelogExtractor, ExtractorCategory } from "../../application/ports/ILifelogExtractor.mjs";

/**
 * Parse a stored message timestamp into the process's local time.
 * Two shapes exist in messages.yml: legacy local strings ('2025-12-30 23:42:43',
 * no zone) and, since early 2026, ISO UTC ('2026-11-07T19:55:44.036Z').
 * moment reads the first as local and converts the second to local, so a late
 * evening ISO entry lands on the day it was written, not the next UTC day.
 */
function localTime(timestamp) {
  if (!timestamp) return null;
  const m = moment(String(timestamp).replace(' ', 'T'));
  return m.isValid() ? m : null;
}

/**
 * User journal entries extractor
 * @implements {ILifelogExtractor}
 */
export class JournalistExtractor extends ILifelogExtractor {
  get source() {
    return 'journalist';
  }

  get category() {
    return ExtractorCategory.JOURNAL;
  }

  get filename() {
    return 'journalist/messages';
  }

  /**
   * Extract journalist messages for a specific date
   * @param {Object} data - Full journalist/messages.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted messages or null
   */
  extractForDate(data, date) {
    const messages = data?.messages || [];

    // Filter messages for the target local date (see localTime for both shapes)
    const dayMessages = messages.filter(
      (msg) => localTime(msg.timestamp)?.format('YYYY-MM-DD') === date
    );

    if (dayMessages.length === 0) return null;

    // Separate user messages from bot responses
    const userMessages = dayMessages.filter(
      (msg) =>
        msg.senderId !== 'bot' &&
        msg.role !== 'assistant' &&
        msg.content &&
        msg.content.length > 10 // Skip short responses like emoji
    );

    if (userMessages.length === 0) return null;

    return {
      messages: userMessages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        senderName: msg.senderName,
      })),
      totalMessages: userMessages.length,
      wordCount: userMessages.reduce(
        (sum, msg) => sum + (msg.content?.split(/\s+/).length || 0),
        0
      ),
    };
  }

  /**
   * Format extracted messages as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry || entry.messages.length === 0) return null;

    const lines = ['JOURNAL ENTRIES:'];

    // Add summary line
    lines.push(
      `  ${entry.totalMessages} message${entry.totalMessages > 1 ? 's' : ''} (${entry.wordCount} words)`
    );

    // Add each message with timestamp - FULL CONTENT, no truncation
    // Journal entries are the most valuable data for day reconstruction
    entry.messages.forEach((msg) => {
      const time = localTime(msg.timestamp)?.format('HH:mm') ?? '--:--';

      // Include full content - never truncate journal entries
      lines.push(`  [${time}] ${msg.content}`);
    });

    return lines.join('\n');
  }
}

// Export singleton instance for backward compatibility
export const journalistExtractor = new JournalistExtractor();

export default JournalistExtractor;
