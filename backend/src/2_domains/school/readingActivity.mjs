/**
 * Project persisted shelf events into the small reading-evidence summary used
 * by the teacher day. Calendar interpretation belongs to the caller: `dayOf`
 * must use the same timezone and boundary as the requested study day.
 */
import { readingEvents } from './bookShelf.mjs';

function uniqueEvents(events) {
  const identities = new Set();
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== 'object') return false;
    const identity = event.entryId ?? event.idempotencyKey ?? event.id;
    if (typeof identity !== 'string' || !identity) return true;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

/**
 * @param {object[]} items persisted shelf items
 * @param {{studyDay: string, dayOf: (iso: string) => string}} options
 * @returns {{studyDay: string, hasActivity: boolean, progressCount: number,
 *   finishedCount: number, bookCount: number}}
 */
export function projectReadingActivity(items, { studyDay, dayOf } = {}) {
  if (typeof dayOf !== 'function') throw new Error('projectReadingActivity requires dayOf');

  let progressCount = 0;
  let finishedCount = 0;
  let bookCount = 0;

  for (const item of (Array.isArray(items) ? items : [])) {
    if (Array.isArray(item?.entries)) {
      // v2 stores the effective study day explicitly. `at` may be the later
      // recording instant or a migrated v1 effective timestamp.
      const entries = uniqueEvents(item.entries).filter(entry => entry.on === studyDay);
      const markedFinishes = entries.filter(entry => entry.kind === 'finished').length;
      // v2 state is authoritative, including a teacher's redate/withdrawal.
      const finishes = item.status === 'finished' && item.finishedOn === studyDay ? 1 : 0;
      // Old v2 writers did not mark finish rows. Attribute at most one bare
      // row to the stored finish, without treating it as a second progress.
      const unmarkedFinish = !markedFinishes && finishes && entries.some(entry => !entry.kind
        && entry.page === undefined && entry.minutes === undefined) ? 1 : 0;
      const progress = entries.filter(entry => !entry.kind || entry.kind === 'progress').length - unmarkedFinish;
      if (progress || finishes) bookCount += 1;
      progressCount += progress;
      finishedCount += finishes;
      continue;
    }
    const evidence = readingEvents(uniqueEvents(item?.events))
      .filter((event) => dayOf(event.at) === studyDay);
    if (!evidence.length) continue;
    bookCount += 1;
    progressCount += evidence.filter((event) => event.kind === 'progress').length;
    finishedCount += evidence.filter((event) => event.kind === 'finished').length;
  }

  return {
    studyDay,
    hasActivity: bookCount > 0,
    progressCount,
    finishedCount,
    bookCount,
  };
}

export default projectReadingActivity;
