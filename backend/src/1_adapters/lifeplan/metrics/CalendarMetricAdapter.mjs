/**
 * Extracts time-allocation metrics from calendar lifelog data.
 */
export class CalendarMetricAdapter {
  #userLoadFile;

  constructor({ userLoadFile }) {
    this.#userLoadFile = userLoadFile;
  }

  getMetricValue(username, measure, date) {
    const data = this.#userLoadFile?.(username, 'calendar');
    if (!data) return null;

    const events = Array.isArray(data)
      ? data.filter(e => e.date === date || e.start?.startsWith(date))
      : (data[date] || []);

    if (!Array.isArray(events)) return null;

    switch (measure) {
      case 'event_count': return events.length;
      case 'total_minutes': {
        return events.reduce((sum, e) => {
          if (e.duration) return sum + e.duration;
          if (e.start && e.end) {
            return sum + (new Date(e.end) - new Date(e.start)) / 60000;
          }
          return sum + 60; // Default 1 hour
        }, 0);
      }
      case 'meeting_count': return events.filter(e =>
        e.type === 'meeting' || e.summary?.toLowerCase().includes('meeting')
      ).length;
      default: return null;
    }
  }
}
