/**
 * ClickUp Lifelog Extractor
 *
 * Extracts task activity from clickup.yml (date-keyed structure)
 * Lifelog contains: tasks CREATED and COMPLETED on each date
 * Note: Status change tracking requires ClickUp paid plan
 *
 * @module journalist/extractors
 */

import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * ClickUp task activity extractor
 * @implements {ILifelogExtractor}
 */
export class ClickupExtractor extends ILifelogExtractor {
  get source() {
    return 'clickup';
  }

  get category() {
    return ExtractorCategory.PRODUCTIVITY;
  }

  get filename() {
    return 'clickup';
  }

  /**
   * Extract task activity for a specific date
   * @param {Object} data - Full clickup.yml data (date-keyed: { '2025-12-30': [...], ... })
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted data or null
   */
  extractForDate(data, date) {
    // Handle both old format (array of in-progress tasks) and new format (date-keyed activity)
    if (Array.isArray(data)) {
      // Old format - in-progress tasks only, no activity dates
      return null;
    }

    // New date-keyed format
    const dayTasks = data?.[date];
    if (!Array.isArray(dayTasks) || !dayTasks.length) return null;

    return {
      created: dayTasks.filter((t) => t.action === 'created'),
      completed: dayTasks.filter((t) => t.action === 'completed'),
      total: dayTasks.length,
    };
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry || entry.total === 0) return null;

    const lines = ['CLICKUP ACTIVITY:'];

    if (entry.created.length) {
      lines.push(`  Tasks created (${entry.created.length}):`);
      entry.created.slice(0, 5).forEach((t) => {
        const taxonomy = t.taxonomy ? Object.values(t.taxonomy).join(' > ') : '';
        const context = taxonomy ? ` [${taxonomy}]` : '';
        lines.push(`    + ${t.name}${context}`);
      });
      if (entry.created.length > 5) {
        lines.push(`    ... and ${entry.created.length - 5} more`);
      }
    }

    if (entry.completed.length) {
      lines.push(`  Tasks completed (${entry.completed.length}):`);
      entry.completed.slice(0, 5).forEach((t) => {
        const taxonomy = t.taxonomy ? Object.values(t.taxonomy).join(' > ') : '';
        const context = taxonomy ? ` [${taxonomy}]` : '';
        lines.push(`    - ${t.name}${context}`);
      });
      if (entry.completed.length > 5) {
        lines.push(`    ... and ${entry.completed.length - 5} more`);
      }
    }

    return lines.join('\n');
  }
}

// Export singleton instance for backward compatibility
export const clickupExtractor = new ClickupExtractor();

export default ClickupExtractor;
