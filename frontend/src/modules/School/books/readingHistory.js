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
export function recentFinishes(items = []) {
  return items.filter(item => item?.projection?.status === 'finished').sort((a, b) => {
    const left = lastFinish(a); const right = lastFinish(b);
    return String(right.day ?? '').localeCompare(String(left.day ?? ''))
      || String(right.recordedAt ?? '').localeCompare(String(left.recordedAt ?? ''));
  });
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
