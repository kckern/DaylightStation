import crypto from 'node:crypto';

/**
 * A unique filename for a single game's record.
 *
 * dataService.user.write overwrites whole files, so a name collision
 * silently destroys a previously-saved game. Millisecond wall-clock
 * resolution alone is not unique enough: double-submits, a retry after a
 * network blip, or two devices for one user routinely land in the same
 * millisecond. crypto.randomUUID() supplies the entropy that makes the name
 * unique; the calendar-day prefix is kept only so the games directory still
 * sorts usefully by day.
 *
 * @param {Date} [date] Defaults to now; accepts an explicit Date for tests.
 * @returns {string} e.g. "2026-08-12-3fa85f64-5717-4562-b3fc-2c963f66afa6"
 */
export function buildGameRecordFilename(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `${day}-${crypto.randomUUID()}`;
}

/**
 * A human-scannable name for the household piano archive. `played_on` selects
 * the directory in the caller and is deliberately the piano client's local
 * calendar day; this filename describes the game within that day.
 */
export function buildChessArchiveFilename(record, userSlug, date = new Date()) {
  const slug = String(userSlug || 'guest').replace(/[^a-zA-Z0-9_-]/g, '-');
  const rawLevel = Number(record?.opponent?.level);
  const level = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 'unknown';
  const durationMs = Math.max(0, Number(record?.duration_ms) || 0);
  const seconds = Math.floor(durationMs / 1000);
  const duration = seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
    : `${seconds}s`;
  const moves = Math.max(0, Math.floor(Number(record?.move_count) || 0));
  // A child leaving a board is a real outcome in the archive, but `left` is an
  // implementation event. Name it `quit` in the human-facing filename.
  const result = String(record?.result || (record?.completed ? 'draw' : 'quit') || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  const outcome = String(record?.outcome || (record?.completed ? 'unknown' : 'quit'))
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${slug}_level${level}_${duration}_${moves}ply_${result}_${outcome}_${stamp}-${crypto.randomUUID()}`;
}

export default { buildGameRecordFilename, buildChessArchiveFilename };
