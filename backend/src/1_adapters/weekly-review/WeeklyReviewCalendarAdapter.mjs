// backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs

export class WeeklyReviewCalendarAdapter {
  #userDataService;
  #householdId;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#userDataService = deps.userDataService;
    this.#householdId = config.householdId;
    this.#logger = deps.logger || console;
  }

  async getEventsForDateRange(startDate, endDate) {
    let raw;
    try {
      raw = await this.#userDataService.readHouseholdSharedData(this.#householdId, 'calendar');
    } catch {
      try {
        raw = await this.#userDataService.readHouseholdAppData(this.#householdId, 'common', 'calendar');
      } catch {
        this.#logger.warn?.('weekly-review.calendar.no-data');
        return [];
      }
    }

    if (!raw) return [];

    const results = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      let dayEvents = [];

      if (Array.isArray(raw)) {
        dayEvents = raw.filter(e => {
          const eventDate = (e.date || e.datetime || '').slice(0, 10);
          return eventDate === dateStr;
        }).map(e => ({
          summary: e.summary || 'Untitled',
          time: e.time || null,
          endTime: e.endTime || null,
          calendar: e.calendarName || e.calendar || null,
          allDay: e.allday || e.allDay || false,
        }));
      } else if (raw[dateStr]) {
        dayEvents = (raw[dateStr] || []).map(e => ({
          summary: e.summary || 'Untitled',
          time: e.time || null,
          endTime: e.endTime || null,
          calendar: e.calendarName || e.calendar || null,
          allDay: e.allday || e.allDay || false,
        }));
      }

      if (dayEvents.length > 0) {
        results.push({ date: dateStr, events: dayEvents });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.debug?.('weekly-review.calendar.loaded', { startDate, endDate, totalEvents: results.reduce((s, d) => s + d.events.length, 0) });
    return results;
  }
}
