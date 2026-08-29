import { IEventFeedRepository } from '#apps/home/ports/IEventFeedRepository.mjs';

export class DataServiceEventFeedRepository extends IEventFeedRepository {
  #dataService; #defaultUser;
  constructor({ dataService, defaultUser }) {
    super();
    if (!dataService?.user?.read) throw new Error('DataServiceEventFeedRepository requires dataService.user.read');
    this.#dataService = dataService;
    this.#defaultUser = defaultUser;
  }
  defaultUsername() { return typeof this.#defaultUser === 'function' ? this.#defaultUser() : this.#defaultUser; }
  loadUpcomingEvents(username) {
    const calendar = this.#dataService.user.read('current/calendar', username);
    const todoist = this.#dataService.user.read('current/todoist', username);
    const clickup = this.#dataService.user.read('current/clickup', username);
    return [
      ...(Array.isArray(calendar) ? calendar.map((e) => ({
        id: e.id, start: e.startDateTime ?? e.startDate ?? null, end: e.endTime ?? null,
        summary: e.summary, description: e.description ?? null, type: 'calendar',
        domain: e.calendarName ?? null, location: e.location ?? null, url: null,
        allday: Boolean(e.allday), status: null,
      })) : []),
      ...(Array.isArray(todoist?.tasks) ? todoist.tasks.map((t) => ({
        id: t.id, start: t.dueDate ?? null, end: null, summary: t.content,
        description: t.description || null, type: 'todoist', domain: 'app.todoist.com',
        location: null, url: t.url ?? `https://app.todoist.com/app/task/${t.id}`,
        allday: false, status: null,
      })) : []),
      ...(Array.isArray(clickup?.tasks) ? clickup.tasks.map((t) => ({
        id: t.id, start: null, end: null, summary: t.name, description: null,
        type: 'clickup', domain: 'app.clickup.com', location: null,
        url: `https://app.clickup.com/t/${t.id}`, allday: false, status: t.status ?? null,
      })) : []),
    ];
  }
}
export default DataServiceEventFeedRepository;
