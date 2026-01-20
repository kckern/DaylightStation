/**
 * Checkins (Foursquare/Swarm) Lifelog Extractor
 *
 * Extracts location check-ins from checkins.yml
 * Structure: Array with 'date' string field
 *
 * @module journalist/extractors
 */

import moment from 'moment';
import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * Location check-ins extractor
 * @implements {ILifelogExtractor}
 */
export class CheckinsExtractor extends ILifelogExtractor {
  get source() {
    return 'checkins';
  }

  get category() {
    return ExtractorCategory.SOCIAL;
  }

  get filename() {
    return 'checkins';
  }

  /**
   * Extract check-ins for a specific date
   * @param {Array} data - Full checkins.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of check-ins or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;

    const items = data
      .filter((e) => e.date === date)
      .map((e) => ({
        time: moment(e.createdAt).format('h:mm A'),
        venue: e.venue?.name,
        category: e.venue?.category,
        address: e.location?.address,
        city: e.location?.city,
        state: e.location?.state,
        shout: e.shout,
        photos: e.photos?.length || 0,
      }));

    return items.length ? items : null;
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted check-ins
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`LOCATION CHECK-INS (${entries.length}):`];

    entries.forEach((e) => {
      const location = e.city ? ` in ${e.city}` : '';
      const shout = e.shout ? ` - "${e.shout}"` : '';
      const photos = e.photos ? ` [${e.photos} photo${e.photos > 1 ? 's' : ''}]` : '';
      lines.push(
        `  - ${e.time}: ${e.venue} (${e.category})${location}${shout}${photos}`
      );
    });

    return lines.join('\n');
  }
}

// Export singleton instance for backward compatibility
export const checkinsExtractor = new CheckinsExtractor();

export default CheckinsExtractor;
