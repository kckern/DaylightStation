// courseChipModel.js — completion/freshness math for CourseTile.jsx's player
// chips (also used by PianoMenuActivity.jsx), split out so Fast Refresh can
// hot-reload the tile component on its own.

// Chips for players idle longer than this dim (the server's recency window is
// far wider — piano.yml progress_overlay.recency_days — so "still shown but
// visibly resting" is the middle state between fresh and gone).
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Completion percent for a chip: prefers a server-computed `percent` (the
 * activity endpoint's season-weighted metric doesn't equal completed/total),
 * else derives from counts. Floors at 1% once anything is completed.
 */
export function chipPercent(u) {
  const server = Number(u?.percent);
  if (Number.isFinite(server) && u?.percent != null) return Math.max(0, Math.min(100, Math.round(server)));
  const total = Number(u?.total) || 0;
  const completed = Number(u?.completed) || 0;
  if (!total || !completed) return 0;
  return Math.max(1, Math.round((completed / total) * 100));
}

/** True when the player's last activity is older than the fresh window. */
export function chipIsStale(u, now = Date.now()) {
  const t = Date.parse(u?.lastPlayedAt || '');
  return Number.isFinite(t) && now - t > FRESH_MS;
}
