// backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs

/**
 * Reads calendar events from multiple data stores for a date range.
 * Merges past events (lifelog) with upcoming events (current) and
 * shared household events. Handles Google Calendar format and flat format.
 */
export class WeeklyReviewCalendarAdapter {
  #userDataService;
  #householdId;
  #defaultUser;
  #timezone;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#userDataService = deps.userDataService;
    this.#householdId = config.householdId;
    this.#defaultUser = config.defaultUser || null;
    this.#timezone = config.timezone || 'America/Los_Angeles';
    this.#logger = deps.logger || console;
  }

  async getEventsForDateRange(startDate, endDate) {
    const allEvents = [];
    const sources = [];

    // 1. User lifelog (past events, date-keyed format)
    if (this.#defaultUser) {
      try {
        const lifelog = this.#userDataService.readUserLifelogData?.(this.#defaultUser, 'calendar');
        if (lifelog && typeof lifelog === 'object' && !Array.isArray(lifelog)) {
          const parsed = this.#parseDateKeyedEvents(lifelog, startDate, endDate);
          const count = parsed.reduce((s, d) => s + d.events.length, 0);
          sources.push({ source: 'lifelog', count });
          for (const day of parsed) allEvents.push(...day.events.map(e => ({ ...e, _date: day.date })));
        }
      } catch (err) {
        this.#logger.debug?.('weekly-review.calendar.lifelog-error', { error: err.message });
      }
    }

    // 2. User current (upcoming events, flat array)
    if (this.#defaultUser) {
      try {
        const userPath = this.#userDataService.getUserDataPath?.(this.#defaultUser, 'current', 'calendar.yml');
        if (userPath) {
          const { loadYamlFromPath } = await import('#system/utils/FileIO.mjs');
          const current = loadYamlFromPath(userPath);
          if (Array.isArray(current)) {
            const parsed = this.#parseArrayEvents(current, startDate, endDate);
            const count = parsed.reduce((s, d) => s + d.events.length, 0);
            sources.push({ source: 'current', count });
            for (const day of parsed) allEvents.push(...day.events.map(e => ({ ...e, _date: day.date })));
          }
        }
      } catch (err) {
        this.#logger.debug?.('weekly-review.calendar.current-error', { error: err.message });
      }
    }

    // 3. Household shared (fallback, Google Calendar format)
    try {
      const shared = this.#userDataService.readHouseholdSharedData?.(this.#householdId, 'calendar');
      if (shared) {
        const parsed = Array.isArray(shared)
          ? this.#parseArrayEvents(shared, startDate, endDate)
          : this.#parseDateKeyedEvents(shared, startDate, endDate);
        const count = parsed.reduce((s, d) => s + d.events.length, 0);
        sources.push({ source: 'shared', count });
        for (const day of parsed) allEvents.push(...day.events.map(e => ({ ...e, _date: day.date })));
      }
    } catch (err) {
      this.#logger.debug?.('weekly-review.calendar.shared-error', { error: err.message });
    }

    // Deduplicate by event ID, merge into date buckets
    const seen = new Set();
    const byDate = new Map();
    for (const event of allEvents) {
      const key = event.id || `${event._date}-${event.summary}-${event.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const date = event._date;
      if (!byDate.has(date)) byDate.set(date, []);
      const { _date, id, ...cleanEvent } = event;
      byDate.get(date).push(cleanEvent);
    }

    const results = [...byDate.entries()]
      .map(([date, events]) => ({ date, events }))
      .sort((a, b) => a.date.localeCompare(b.date));

    this.#logger.info?.('weekly-review.calendar.loaded', {
      startDate,
      endDate,
      sources,
      totalEvents: results.reduce((s, d) => s + d.events.length, 0),
      daysWithEvents: results.length,
    });

    return results;
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

    return [...byDate.entries()]
      .map(([date, events]) => ({ date, events }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  #parseDateKeyedEvents(raw, startDate, endDate) {
    const results = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayRaw = raw[dateStr];
      if (Array.isArray(dayRaw) && dayRaw.length > 0) {
        const dayEvents = dayRaw.map(e => this.#parseEvent(e)).filter(Boolean);
        if (dayEvents.length > 0) {
          results.push({ date: dateStr, events: dayEvents });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return results;
  }

  #parseEvent(event) {
    // Google Calendar format
    if (event.start?.dateTime || event.start?.date) {
      const startRaw = event.start.dateTime || event.start.date;
      const endRaw = event.end?.dateTime || event.end?.date;
      const isAllDay = !!(event.start.date && !event.start.dateTime);

      const startDate = new Date(startRaw);
      if (isNaN(startDate.getTime())) return null;

      return {
        id: event.id || null,
        summary: event.summary || 'Untitled',
        time: isAllDay ? null : this.#toLocalTime(startDate),
        endTime: isAllDay || !endRaw ? null : this.#toLocalTime(new Date(endRaw)),
        calendar: event.organizer?.displayName || event.calendarName || null,
        allDay: isAllDay,
        date: this.#toLocalDate(startDate),
      };
    }

    // Flat format (from lifelog/current stores)
    const eventDate = (event.date || event.startDate || event.datetime || '').slice(0, 10);
    if (!eventDate || eventDate.length !== 10) return null;

    return {
      id: event.id || null,
      summary: event.summary || 'Untitled',
      time: event.time || null,
      endTime: event.endTime || null,
      calendar: event.calendarName || event.calendar || null,
      allDay: event.allday || event.allDay || false,
      date: eventDate,
    };
  }

  #toLocalDate(date) {
    try {
      return date.toLocaleDateString('en-CA', { timeZone: this.#timezone });
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

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
