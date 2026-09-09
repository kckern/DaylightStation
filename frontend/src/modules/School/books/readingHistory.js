/** Effective dates come from finish events; recordedAt is separate evidence. */
export function lastFinish(item) {
  if (Array.isArray(item?.entries)) {
    const finish = item.entries.filter(entry => entry.kind === 'finished' && entry.on === item.finishedOn).at(-1);
    return { day: item.finishedOn ?? null, recordedAt: finish?.recordedAt ?? null };
  }
  const events = (item?.events ?? []).filter(event => event.kind === 'finished');
  const event = events.at(-1);
  return {
    day: event?.finishedOn ?? event?.at ?? (item?.projection?.status === 'finished' ? item.projection.lastAt : null),
    recordedAt: event?.recordedAt ?? null,
  };
}
/**
 * Everything a child is DONE with, newest first — finished and set aside alike.
 *
 * The row this feeds used to hold finished books only, which quietly hid the
 * set-aside ones until a child opened full history. They are two outcomes of
 * the same act, they sort on the same dates, and the tile's own mark is what
 * tells them apart.
 */
export function recentOutcomes(items = []) {
  return sortByOutcome(items.filter(item => DONE.has(item?.projection?.status)));
}

const DONE = new Set(['finished', 'set-aside']);

export function recentFinishes(items = []) {
  return sortByOutcome(items.filter(item => item?.projection?.status === 'finished'));
}

function sortByOutcome(items) {
  return items.sort((a, b) => {
    const left = outcomeDay(a); const right = outcomeDay(b);
    return String(right.day ?? '').localeCompare(String(left.day ?? ''))
      || String(right.recordedAt ?? '').localeCompare(String(left.recordedAt ?? ''));
  });
}

/** A set-aside reading has no finish event; its date is when it was last touched. */
function outcomeDay(item) {
  if (item?.projection?.status === 'set-aside') return { day: item.projection.lastAt ?? null, recordedAt: item.projection.lastAt ?? null };
  return lastFinish(item);
}
export function finishDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(day ?? '')) return null;
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function recordingTime(value) {
  // A legacy `at` value may look like midnight but is not a recording time.
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
