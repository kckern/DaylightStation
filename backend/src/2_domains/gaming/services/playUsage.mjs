/**
 * Rolls recorded play sessions up into something a person can actually watch.
 *
 * Raw per-day session files answer "what happened" only if you are willing to
 * read them. This answers the questions someone monitoring usage actually asks:
 * who played, what, for how long, on which day.
 *
 * Pure: it folds the sessions it is handed and reaches for nothing.
 *
 * It reports PLAYED time — the time a surface was observed playing — not the
 * span a game was open. Those differ by whatever was spent paused, backgrounded
 * or sitting on a title screen, and the difference is frequently most of it.
 * `unattributed` exists because a session whose player could not be identified
 * must still appear in the total; quietly dropping it would make the ledger
 * understate reality precisely where it is least trustworthy.
 */

const UNATTRIBUTED = '(unattributed)';

function addTo(bucket, key, ms, sessionId) {
  const row = bucket.get(key) || { key, playedMs: 0, sessions: 0, ids: [] };
  row.playedMs += ms;
  row.sessions += 1;
  row.ids.push(sessionId);
  bucket.set(key, row);
}

function sortedRows(bucket) {
  return [...bucket.values()]
    .map(({ ids, ...row }) => row)
    .sort((a, b) => b.playedMs - a.playedMs);
}

/**
 * @param {Array<object>} sessions  PlaySession snapshots or entities.
 * @returns {{totalPlayedMs, sessionCount, byUser, byTitle, byDevice, byDay, sessions}}
 */
export function summariseUsage(sessions = []) {
  const byUser = new Map();
  const byTitle = new Map();
  const byDevice = new Map();
  const byDay = new Map();
  const rows = [];
  let totalPlayedMs = 0;

  for (const s of sessions) {
    const playedMs = Number(s?.playedMs) || 0;
    const startedAt = s?.startedAt || null;
    const day = startedAt ? String(startedAt).slice(0, 10) : 'unknown';
    const user = s?.payerId || s?.userId || UNATTRIBUTED;
    const title = s?.content?.title || s?.content?.contentId || '(unidentified)';
    const device = s?.deviceId || '(unknown device)';
    const id = s?.id || null;

    totalPlayedMs += playedMs;
    addTo(byUser, user, playedMs, id);
    addTo(byTitle, title, playedMs, id);
    addTo(byDevice, device, playedMs, id);
    addTo(byDay, day, playedMs, id);

    rows.push({
      id,
      startedAt,
      endedAt: s?.endedAt ?? null,
      deviceId: device,
      userId: s?.payerId || s?.userId || null,
      participants: s?.participants ?? [],
      title,
      contentId: s?.content?.contentId ?? null,
      playedMs,
      // How precisely that number was measured. Shown rather than implied, so a
      // figure gathered by polling is never mistaken for a stopwatch.
      confidenceMs: Number(s?.confidenceMs) || 0,
      status: s?.status ?? null,
      endReason: s?.endReason ?? null,
      grantRef: s?.grantRef ?? null,
    });
  }

  return {
    totalPlayedMs,
    sessionCount: sessions.length,
    byUser: sortedRows(byUser),
    byTitle: sortedRows(byTitle),
    byDevice: sortedRows(byDevice),
    byDay: [...byDay.values()].map(({ ids, ...r }) => r).sort((a, b) => a.key.localeCompare(b.key)),
    sessions: rows,
  };
}

/** "1h 12m" / "4m 30s" / "45s" — for a person, not a machine. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export { UNATTRIBUTED };
