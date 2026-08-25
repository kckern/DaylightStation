/** Human dates for the adult console. Storage stays ISO; it never leaks into copy. */
function dateFor(value) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function teacherDate(value, { weekday = false } = {}) {
  const date = dateFor(value);
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    ...(weekday ? { weekday: 'long' } : {}), month: 'short', day: 'numeric', year: 'numeric',
  }).format(date);
}

export function teacherDateRange(from, to = null) {
  if (!to || to === from) return teacherDate(from);
  const start = dateFor(from);
  const end = dateFor(to);
  if (!start || !end) return 'Date unavailable';
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start)}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${teacherDate(from)} – ${teacherDate(to)}`;
}
