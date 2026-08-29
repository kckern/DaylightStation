export class IEventFeedRepository {
  defaultUsername() { throw new Error('defaultUsername must be implemented'); }
  loadUpcomingEvents() { throw new Error('loadUpcomingEvents must be implemented'); }
}

export function isEventFeedRepository(value) {
  return value != null
    && typeof value.defaultUsername === 'function'
    && typeof value.loadUpcomingEvents === 'function';
}
