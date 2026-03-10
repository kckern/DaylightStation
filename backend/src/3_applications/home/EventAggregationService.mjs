/** @module EventAggregationService */

/**
 * Aggregates upcoming events from calendar, todoist, and clickup
 * into a unified event list sorted by start date.
 */
export class EventAggregationService {
  #dataService;
  #configService;
  #logger;

  constructor({ dataService, configService, logger }) {
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger?.child?.({ component: 'EventAggregationService' }) ?? logger;
  }

  /**
   * Reads all three event sources, maps to unified schema, and sorts by start date.
   * @param {string} [username] - Defaults to head of household
   * @returns {Array<Object>} Unified event list
   */
  getUpcomingEvents(username) {
    const user = username ?? this.#configService.getHeadOfHousehold();

    const calendarData = this.#dataService.user.read('current/calendar', user);
    const todoistData = this.#dataService.user.read('current/todoist', user);
    const clickupData = this.#dataService.user.read('current/clickup', user);

    const calendarEvents = this.#mapCalendar(calendarData);
    const todoistEvents = this.#mapTodoist(todoistData);
    const clickupEvents = this.#mapClickup(clickupData);

    const all = [...calendarEvents, ...todoistEvents, ...clickupEvents];

    return all.sort((a, b) => {
      if (a.start === null && b.start === null) return 0;
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start.localeCompare(b.start);
    });
  }

  #mapCalendar(data) {
    if (!Array.isArray(data)) return [];
    return data.map((e) => ({
      id: e.id,
      start: e.startDateTime ?? e.startDate ?? null,
      end: e.endTime ?? null,
      summary: e.summary,
      description: e.description ?? null,
      type: 'calendar',
      domain: e.calendarName ?? null,
      location: e.location ?? null,
      url: null,
      allday: Boolean(e.allday),
      status: null,
    }));
  }

  #mapTodoist(data) {
    const tasks = data?.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.map((t) => ({
      id: t.id,
      start: t.dueDate ?? null,
      end: null,
      summary: t.content,
      description: t.description || null,
      type: 'todoist',
      domain: 'app.todoist.com',
      location: null,
      url: t.url ?? `https://app.todoist.com/app/task/${t.id}`,
      allday: true,
      status: null,
    }));
  }

  #mapClickup(data) {
    const tasks = data?.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.map((t) => ({
      id: t.id,
      start: null,
      end: null,
      summary: t.name,
      description: null,
      type: 'clickup',
      domain: 'app.clickup.com',
      location: null,
      url: `https://app.clickup.com/t/${t.id}`,
      allday: false,
      status: t.status ?? null,
    }));
  }
}
