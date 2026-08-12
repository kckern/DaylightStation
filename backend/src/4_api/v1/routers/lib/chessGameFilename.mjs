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

export default { buildGameRecordFilename };
