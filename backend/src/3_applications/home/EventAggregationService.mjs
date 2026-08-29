/** @module EventAggregationService */

import { isEventFeedRepository } from './ports/IEventFeedRepository.mjs';
import moment from 'moment';

const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;

function truncate(value, length) {
  const text = String(value ?? '').trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/**
 * Aggregates upcoming events from calendar, todoist, and clickup
 * into a unified event list sorted by start date.
 */
export class EventAggregationService {
  #eventRepository;
  #logger;

  constructor({ eventRepository, logger }) {
    if (!isEventFeedRepository(eventRepository)) throw new Error('EventAggregationService requires eventRepository');
    this.#eventRepository = eventRepository;
    this.#logger = logger?.child?.({ component: 'EventAggregationService' }) ?? logger;
  }

  /**
   * Reads all three event sources, maps to unified schema, and sorts by start date.
   * @param {string} [username] - Defaults to head of household
   * @returns {Array<Object>} Unified event list
   */
  getUpcomingEvents(username) {
    const user = username ?? this.#eventRepository.defaultUsername();
    const all = this.#eventRepository.loadUpcomingEvents(user);

    return all.sort((a, b) => {
      if (a.start === null && b.start === null) return 0;
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start.localeCompare(b.start);
    });
  }

  getCalendarAgenda({ limit = 8 } = {}) {
    const now = moment();
    const startOfToday = now.clone().startOf('day');
    return this.getUpcomingEvents()
      .filter((event) => event.type === 'calendar' && event.start)
      .map((event) => ({ event, start: moment.parseZone(event.start) }))
      .filter(({ start }) => start.isValid() && start.isSameOrAfter(startOfToday))
      .sort((a, b) => a.start.valueOf() - b.start.valueOf())
      .slice(0, Math.min(Number(limit) || 8, 20))
      .map(({ event, start }) => ({
        day: start.isSame(now, 'day') ? 'Today'
          : (start.isSame(now.clone().add(1, 'day'), 'day') ? 'Tmrw' : start.format('ddd')),
        time: event.allday ? '' : `${start.minutes() === 0 ? start.format('h') : start.format('h:mm')}${start.hours() < 12 ? 'a' : 'p'}`,
        title: truncate(event.summary, 26),
      }));
  }

  getTodoAgenda({ limit = 8 } = {}) {
    return this.getUpcomingEvents()
      .filter((event) => event.type === 'todoist')
      .map((event) => truncate(String(event.summary ?? '').replace(MARKDOWN_LINK, '$1').replace(/\s+/g, ' ').trim(), 28))
      .filter(Boolean)
      .slice(0, Math.min(Number(limit) || 8, 20))
      .map((text) => ({ text, done: false }));
  }

}
