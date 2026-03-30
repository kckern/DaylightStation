// backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs

/**
 * Reads calendar events from the household data store for a date range.
 * Handles Google Calendar format (start.dateTime / start.date) as well as
 * pre-formatted flat events (date, time fields).
 */
export class WeeklyReviewCalendarAdapter {
  #userDataService;
  #householdId;
  #timezone;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#userDataService = deps.userDataService;
    this.#householdId = config.householdId;
    this.#timezone = config.timezone || 'America/Los_Angeles';
    this.#logger = deps.logger || console;
  }

  async getEventsForDateRange(startDate, endDate) {
    let raw;
    try {
      raw = this.#userDataService.readHouseholdSharedData?.(this.#householdId, 'calendar');
    } catch {
      try {
        raw = this.#userDataService.readHouseholdAppData?.(this.#householdId, 'common', 'calendar');
      } catch {
        this.#logger.warn?.('weekly-review.calendar.no-data');
        return [];
      }
    }

    if (!raw) {
      this.#logger.warn?.('weekly-review.calendar.null-data');
      return [];
    }

    // Handle array format (Google Calendar events or flat events)
    if (Array.isArray(raw)) {
      this.#logger.debug?.('weekly-review.calendar.raw-format', { format: 'array', count: raw.length });
      return this.#parseArrayEvents(raw, startDate, endDate);
    }

    // Handle date-keyed object format
    if (typeof raw === 'object') {
      this.#logger.debug?.('weekly-review.calendar.raw-format', { format: 'date-keyed', keys: Object.keys(raw).length });
      return this.#parseDateKeyedEvents(raw, startDate, endDate);
    }

    this.#logger.warn?.('weekly-review.calendar.unknown-format', { type: typeof raw });
    return [];
  }

  #parseArrayEvents(events, startDate, endDate) {
    const byDate = new Map();

    for (const event of events) {
      const parsed = this.#parseEvent(event);
      if (!parsed) continue;

      if (parsed.date >= startDate && parsed.date <= endDate) {
        if (!byDate.has(parsed.date)) byDate.set(parsed.date, []);
        byDate.get(parsed.date).push(parsed);
      }
    }

    const results = [];
    for (const [date, dayEvents] of byDate) {
      dayEvents.sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.time || '').localeCompare(b.time || '');
      });
      results.push({ date, events: dayEvents });
    }
    results.sort((a, b) => a.date.localeCompare(b.date));

    this.#logger.info?.('weekly-review.calendar.loaded', {
      startDate,
      endDate,
      rawCount: events.length,
      matchedDays: results.length,
      totalEvents: results.reduce((s, d) => s + d.events.length, 0),
    });

    return results;
  }

  #parseDateKeyedEvents(raw, startDate, endDate) {
    const results = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayRaw = raw[dateStr];
      if (Array.isArray(dayRaw) && dayRaw.length > 0) {
        const dayEvents = dayRaw.map(e => ({
          summary: e.summary || 'Untitled',
          time: e.time || null,
          endTime: e.endTime || null,
          calendar: e.calendarName || e.calendar || null,
          allDay: e.allday || e.allDay || false,
        }));
        results.push({ date: dateStr, events: dayEvents });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.info?.('weekly-review.calendar.loaded', {
      startDate,
      endDate,
      matchedDays: results.length,
      totalEvents: results.reduce((s, d) => s + d.events.length, 0),
    });

    return results;
  }

  /**
   * Parse a single event from either Google Calendar format or flat format.
   */
  #parseEvent(event) {
    // Google Calendar format: start.dateTime or start.date
    if (event.start?.dateTime || event.start?.date) {
      const startRaw = event.start.dateTime || event.start.date;
      const endRaw = event.end?.dateTime || event.end?.date;
      const isAllDay = !!(event.start.date && !event.start.dateTime);

      const startDate = new Date(startRaw);
      if (isNaN(startDate.getTime())) return null;

      const date = this.#toLocalDate(startDate);
      const time = isAllDay ? null : this.#toLocalTime(startDate);
      const endTime = isAllDay || !endRaw ? null : this.#toLocalTime(new Date(endRaw));

      return {
        summary: event.summary || 'Untitled',
        time,
        endTime,
        calendar: event.organizer?.displayName || event.creator?.displayName || null,
        allDay: isAllDay,
        date,
      };
    }

    // Flat format: date/datetime + time fields
    const eventDate = (event.date || event.datetime || '').slice(0, 10);
    if (!eventDate || eventDate.length !== 10) return null;

    return {
      summary: event.summary || 'Untitled',
      time: event.time || null,
      endTime: event.endTime || null,
      calendar: event.calendarName || event.calendar || null,
      allDay: event.allday || event.allDay || false,
      date: eventDate,
    };
  }

  /**
   * Convert a Date to YYYY-MM-DD in the configured timezone.
   * Falls back to UTC offset approximation if Intl is unavailable.
   */
  #toLocalDate(date) {
    try {
      return date.toLocaleDateString('en-CA', { timeZone: this.#timezone }); // en-CA gives YYYY-MM-DD
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  /**
   * Convert a Date to h:mm AM/PM in the configured timezone.
   */
  #toLocalTime(date) {
    try {
      return date.toLocaleTimeString('en-US', {
        timeZone: this.#timezone,
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return date.toISOString().slice(11, 16);
    }
  }
}
