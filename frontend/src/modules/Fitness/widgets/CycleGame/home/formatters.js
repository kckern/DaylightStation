export function formatDistance(meters) {
  const m = Math.max(0, Math.round(meters || 0));
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${m} m`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s % 60 === 0) return `${s / 60} min`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Header label for a day column: Today / Yesterday / weekday + date. */
export function formatDayHeader(day) {
  if (!day || day === 'unknown') return 'Earlier';
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const y = new Date(now.getTime() - 86400000);
  const yestStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  if (day === todayStr) return 'Today';
  if (day === yestStr) return 'Yesterday';
  const [yr, mo, d] = day.split('-').map(Number);
  return new Date(yr, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
