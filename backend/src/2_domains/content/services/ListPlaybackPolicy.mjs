const WATCHED_THRESHOLD = 90;
const MIN_PROGRESS_THRESHOLD = 1;
const DAY_PRESETS = Object.freeze({
  daily: ['M', 'T', 'W', 'Th', 'F', 'Saturday', 'Sunday'],
  weekdays: ['M', 'T', 'W', 'Th', 'F'],
  weekend: ['Saturday', 'Sunday'],
  mwf: ['M', 'W', 'F'],
  tth: ['T', 'Th'],
});
const DAYS = ['Sunday', 'M', 'T', 'W', 'Th', 'F', 'Saturday'];

export function normalizeListDays(days) {
  if (!days) return [];
  if (typeof days === 'string') {
    const preset = DAY_PRESETS[days.toLowerCase()];
    if (preset) return preset;
    if (days.includes('•')) return days.split('•').map(day => day.trim()).filter(Boolean);
    return [days];
  }
  return Array.isArray(days) ? days : [];
}

export function listItemMatchesDay(item, dayIndex) {
  if (!item?.days) return true;
  const expected = DAYS[dayIndex];
  const days = normalizeListDays(item.days);
  if (!days.length) return true;
  return days.some(day => String(day).toLowerCase() === expected.toLowerCase());
}

export function watchlistPriority(item, watchState, nowMs) {
  if ((watchState?.percent || 0) > MIN_PROGRESS_THRESHOLD) return 'in_progress';
  if (item?.skip_after) {
    const horizon = new Date(nowMs);
    horizon.setDate(horizon.getDate() + 8);
    if (new Date(item.skip_after) <= horizon) return 'urgent';
  }
  return item?.priority || 'medium';
}

export function shouldSkipListPlayback(metadata, { today, nowMs }) {
  const meta = metadata || {};
  if (meta.hold) return true;
  if (meta.versionState) {
    if (meta.versionState === 'complete') return true;
  } else if (meta.percent >= WATCHED_THRESHOLD || meta.watched) return true;

  if (meta.skipAfter && !meta.versionState && meta.skipAfter < today) return true;
  if (meta.waitUntil) {
    if (meta.versionState) return meta.waitUntil > today;
    const horizon = new Date(nowMs);
    horizon.setDate(horizon.getDate() + 2);
    return new Date(meta.waitUntil) > horizon;
  }
  return false;
}

export function cascadePriority(meta, today) {
  const current = !meta.skipAfter || meta.skipAfter >= today;
  if (!meta.versionState || meta.versionState === 'unwatched') return current ? 0 : 1;
  if (meta.versionState === 'partial') return current ? 2 : 3;
  return 4;
}

export function compareWatchlistItems(a, b) {
  const order = ['in_progress', 'urgent', 'high', 'medium', 'low'];
  const priorityA = order.indexOf(a.metadata?.priority || 'medium');
  const priorityB = order.indexOf(b.metadata?.priority || 'medium');
  if (priorityA !== priorityB) return priorityA - priorityB;
  if (a.metadata?.priority === 'in_progress' && b.metadata?.priority === 'in_progress') {
    return (b.metadata?.percent || 0) - (a.metadata?.percent || 0);
  }
  return 0;
}
