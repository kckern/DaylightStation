/** Calendar event storage and household calendar policy. */
import moment from 'moment-timezone';

export class CalendarReadContext {
  constructor({ householdContext, eventSource, loadEvents, logger = console } = {}) {
    this.householdContext = householdContext;
    this.eventSource = eventSource || (loadEvents ? { readEvents: loadEvents } : null);
    this.logger = logger;
  }

  resolveHousehold(explicit = null) { return this.householdContext.resolve(explicit, 'default'); }
  timezone(householdId) { return this.householdContext.timezone(householdId); }
  events(householdId) {
    try {
      return this.eventSource?.readEvents(householdId) || [];
    } catch (error) {
      this.logger.warn?.('calendar.load.error', { householdId, error: error.message });
      return [];
    }
  }

  #formatEvent(event, timezone) {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const allDay = Boolean(event.start?.date && !event.start?.dateTime);
    return {
      id: event.id,
      summary: event.summary || 'Untitled Event',
      description: event.description || null,
      location: event.location || null,
      start,
      end,
      allDay,
      date: moment(start).tz(timezone).format('YYYY-MM-DD'),
      time: allDay ? null : moment(start).tz(timezone).format('h:mm A'),
      endTime: allDay ? null : moment(end).tz(timezone).format('h:mm A'),
      calendar: event.organizer?.displayName || event.creator?.displayName || null,
    };
  }

  #between(events, startDate, endDate, timezone) {
    return events.filter((event) => {
      const eventDate = moment(event.start?.dateTime || event.start?.date).tz(timezone);
      return eventDate.isSameOrAfter(startDate, 'day') && eventDate.isSameOrBefore(endDate, 'day');
    });
  }

  #ordered(householdId, startDate, endDate, { allDayFirst = false } = {}) {
    const timezone = this.timezone(householdId);
    return this.#between(this.events(householdId), startDate, endDate, timezone)
      .map((event) => this.#formatEvent(event, timezone))
      .sort((a, b) => {
        if (allDayFirst && a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return new Date(a.start) - new Date(b.start);
      });
  }

  upcoming(explicitHousehold, days = 14) {
    const householdId = this.resolveHousehold(explicitHousehold);
    const timezone = this.timezone(householdId);
    const now = moment().tz(timezone);
    return this.#ordered(householdId, now, now.clone().add(days, 'days'));
  }

  today(explicitHousehold) {
    const householdId = this.resolveHousehold(explicitHousehold);
    const timezone = this.timezone(householdId);
    const date = moment().tz(timezone).startOf('day');
    return { householdId, date: date.format('YYYY-MM-DD'), events: this.#ordered(householdId, date, date, { allDayFirst: true }) };
  }

  onDate(explicitHousehold, dateText) {
    const date = moment(dateText, 'YYYY-MM-DD', true);
    if (!date.isValid()) return { kind: 'invalid_date' };
    const householdId = this.resolveHousehold(explicitHousehold);
    return { kind: 'found', householdId, events: this.#ordered(householdId, date, date, { allDayFirst: true }) };
  }
}

export default CalendarReadContext;
