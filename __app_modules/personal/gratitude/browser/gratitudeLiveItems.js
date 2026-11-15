/** Stored server events must not become a second POST from each open display. */
export const shouldPersistIncoming = payload => payload.persisted !== true && payload.source !== 'homebot';
export function mergeGratitudeItems(existing, incoming) {
  const ids = new Set(incoming.map(item => item.id));
  return [...incoming, ...existing.filter(item => !ids.has(item.id))];
}
