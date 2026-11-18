/**
 * Outside evidence for the piano link repair (PianoBridgeSupervisorService).
 *
 * The tablet's own "connected" was false during the 2026-11-18 outage, so the
 * repair decides from what the far end of the link says, and from whether a
 * person is at the kiosk.
 */
const DEFAULT_TIMEOUT_MS = 5000;
const ACTIVITY_WINDOW = '5m';
const GAME_MAX_AGE = '2h';

// Keep in step with ops:scripts/piano-kiosk-idle.sh, which guards deploys and reloads.
const HUMAN_EVENTS = [
  'chess.move', 'chess.rejected', 'pickup', 'move-played', 'checkers.hint', 'checkers.move',
  'piano.history.flush', 'chord.identify', 'piano.exercise-observation',
  'gate.presented', 'gate.attempt', 'game.mount',
];

/**
 * @returns {() => Promise<number|null>} BLE clients the JamCorder reports; null when unknown.
 * Unknown must never read as zero: zero is the evidence that reboots the tablet.
 */
export function createJamcorderClientReader({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!baseUrl) throw new Error('createJamcorderClientReader requires baseUrl');
  const url = `${baseUrl.replace(/\/+$/, '')}/api/bluetooth/state/get`;
  return async function readJamcorderClients() {
    try {
      const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (!res?.ok) return null;
      const clients = (await res.json())?.clients;
      return Array.isArray(clients) ? clients.length : null;
    } catch {
      return null;
    }
  };
}

/**
 * Is anyone using the piano kiosk? A log store failure rejects, so the caller
 * can treat "could not tell" as "someone may be there".
 * @returns {() => Promise<{idle:boolean, reason:'game'|'activity'|null}>}
 */
export function createPianoKioskIdleCheck({ queryLogs } = {}) {
  if (typeof queryLogs !== 'function') throw new Error('createPianoKioskIdleCheck requires queryLogs');
  const lastSeen = async (event) => {
    const rows = await queryLogs(
      `_time:${GAME_MAX_AGE} AND context.app:piano-kiosk AND "${event}" | sort by (_time desc) | limit 1`,
    );
    return rows[0]?._time ?? null;
  };
  return async function checkPianoKioskIdle() {
    const [mountedAt, unmountedAt] = await Promise.all([lastSeen('game.mount'), lastSeen('game.unmount')]);
    if (mountedAt && (!unmountedAt || Date.parse(mountedAt) > Date.parse(unmountedAt))) {
      return { idle: false, reason: 'game' };
    }
    const human = HUMAN_EVENTS.map((e) => `"${e}"`).join(' OR ');
    const active = await queryLogs(`_time:${ACTIVITY_WINDOW} AND context.app:piano-kiosk AND (${human})`);
    return active.length ? { idle: false, reason: 'activity' } : { idle: true, reason: null };
  };
}
