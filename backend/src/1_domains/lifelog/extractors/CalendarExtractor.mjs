/**
 * Calendar Lifelog Extractor
 *
 * Extracts past calendar events from calendar.yml (date-keyed structure)
 * Lifelog contains: events that occurred on each date
 *
 * @module journalist/extractors
 */

import moment from 'moment';
import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

/**
 * Calendar events extractor
 * @implements {ILifelogExtractor}
 */
export class CalendarExtractor extends ILifelogExtractor {
  get source() {
    return 'calendar';
  }

  get category() {
    return ExtractorCategory.CALENDAR;
  }

  get filename() {
    return 'calendar';
  }

  /**
   * Extract events for a specific date
   * @param {Object} data - Full calendar.yml data (date-keyed: { '2025-12-30': [...], ... })
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of events or null
   */
  extractForDate(data, date) {
    // Handle both old format (array) and new format (date-keyed object)
    if (Array.isArray(data)) {
      // Old format - filter by start date
      const events = data
        .filter((e) => {
          if (!e.start) return false;
          const eventDate = e.start?.dateTime || e.start?.date || e.start;
          return moment(eventDate).format('YYYY-MM-DD') === date;
        })
        .map((e) => {
          const start = e.start?.dateTime || e.start?.date || e.start;
          const end = e.end?.dateTime || e.end?.date || e.end;
          const allday = !!(e.start?.date && !e.start?.dateTime) || e.allday;
          return {
            time: allday ? null : moment(start).format('h:mm A'),
            endTime: allday ? null : moment(end).format('h:mm A'),
            summary: e.summary || 'Untitled Event',
            duration: e.duration,
            location: e.location,
            calendarName: e.calendarName || e.organizer?.displayName,
            allday,
            description: e.description,
          };
        });
      return events.length ? events : null;
    }

    // New date-keyed format
    const dayEvents = data?.[date];
    if (!Array.isArray(dayEvents) || !dayEvents.length) return null;

    return dayEvents.map((e) => ({
      time: e.time,
      endTime: e.endTime,
      summary: e.summary || 'Untitled Event',
      duration: e.duration,
      location: e.location,
      calendarName: e.calendarName,
      allday: e.allday,
      description: e.description,
    }));
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted events
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;

    const lines = [`CALENDAR EVENTS (${entries.length}):`];

    entries.forEach((e) => {
      const duration = e.duration ? ` (${e.duration.toFixed(1)}h)` : '';
      const location = e.location ? ` at ${e.location}` : '';
      const calendar = e.calendarName ? ` [${e.calendarName}]` : '';

      if (e.allday) {
        lines.push(`  - All Day: ${e.summary}${location}${calendar}`);
      } else {
        lines.push(
          `  - ${e.time}-${e.endTime}: ${e.summary}${duration}${location}${calendar}`
        );
      }
    });

    return lines.join('\n');
  }
}

// Export singleton instance for backward compatibility
export const calendarExtractor = new CalendarExtractor();

export default CalendarExtractor;
