// waitAge.js — queue-wait age formatting for ReviewQueueView.jsx (also used
// by PrintPendingView.jsx), split out so Fast Refresh can hot-reload the
// review queue component on its own.
export function waitAge(enqueuedAt, now = Date.now()) {
  const at = Date.parse(enqueuedAt ?? '');
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
