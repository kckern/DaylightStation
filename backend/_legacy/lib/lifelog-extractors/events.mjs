/**
 * Events (Calendar) Lifelog Extractor
 * 
 * Extracts calendar events from events.yml
 * Structure: Array with ISO 'start' datetime
 */

import moment from 'moment';

export const eventsExtractor = {
  source: 'events',
  category: 'calendar',
  filename: 'events',
  
  /**
   * Extract events for a specific date
   * @param {Array} data - Full events.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of events or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    
    const events = data.filter(e => {
      if (!e.start) return false;
      return moment(e.start).format('YYYY-MM-DD') === date;
    }).map(e => ({
      time: moment(e.start).format('h:mm A'),
      endTime: moment(e.end).format('h:mm A'),
      title: e.summary || 'Untitled Event',
      duration: e.duration,
      location: e.location,
      calendar: e.calendarName,
      allDay: e.allday,
      description: e.description
    }));
    
    return events.length ? events : null;
  },

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted events
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`CALENDAR EVENTS (${entries.length}):`];
    entries.forEach(e => {
      const duration = e.duration ? ` (${e.duration}h)` : '';
      const location = e.location ? ` at ${e.location}` : '';
      const calendar = e.calendar ? ` [${e.calendar}]` : '';
      if (e.allDay) {
        lines.push(`  - All Day: ${e.title}${location}${calendar}`);
      } else {
        lines.push(`  - ${e.time}-${e.endTime}: ${e.title}${duration}${location}${calendar}`);
      }
    });
    return lines.join('\n');
  }
};

export default eventsExtractor;
