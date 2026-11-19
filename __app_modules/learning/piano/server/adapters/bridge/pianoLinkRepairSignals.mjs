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
const TELEMETRY_EVENT = 'perf.diagnostics';

/**
 * Events the kiosk emits with nobody there (measured overnight, 2026-11-18). Everything
 * else counts as a person, so an event added later errs toward leaving the tablet alone.
 * A list of human events is not enough here: the signals it relies on most are MIDI,
 * and MIDI is what is broken when this runs.
 */
const BACKGROUND_EVENTS = new Set([
  'perf.diagnostics', 'perf.diagnostics.started', 'perf.diagnostics.rearmed', 'log.ingest.throttled',
  'websocket.connecting', 'websocket.connected', 'websocket.disconnected', 'websocket.error',
  'websocket.reconnect-scheduled', 'session-log.start', 'mounted', 'piano-app.mount',
  'bridge.connecting', 'bridge.open', 'bridge-out.available', 'bridge-out.unverified', 'bridge-out.verified',
  'midi.access-granted', 'midi.statechange', 'midi.output-bound', 'midi.output+holdinput-bound',
  'midi.webmidi-released', 'midi.out.cc', 'midi.out.voice', 'midi.out.bank-msb', 'midi.out.bank-lsb',
  'midi.out.local-control', 'piano.sound.resync', 'piano.mix.cc7-assert', 'piano.device.effect',
  'piano.device.voice', 'piano.school-access.verdict',
]);

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

/** @returns {() => Promise<boolean|null>} tablet screen on; null when unknown */
export function createTabletScreenReader({ bridgeUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!bridgeUrl) throw new Error('createTabletScreenReader requires bridgeUrl');
  const base = bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
  return async function readTabletScreenOn() {
    try {
      const res = await fetchImpl(`${base}/info`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (!res?.ok) return null;
      const interactive = (await res.json())?.power?.interactive;
      return typeof interactive === 'boolean' ? interactive : null;
    } catch {
      return null;
    }
  };
}

function parseTime(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`unreadable log time: ${value}`);
  return ms;
}

/**
 * Is anyone using the piano kiosk? Silence alone is not proof: with the screen on the
 * page must also be seen logging, or a dead log pipeline would read as an empty room.
 * A log store failure rejects, so the caller can treat it as "someone may be there".
 * @returns {() => Promise<{idle:boolean, reason:'game'|'activity'|'no-telemetry'|null}>}
 */
export function createPianoKioskIdleCheck({ queryLogs, readScreenOn } = {}) {
  if (typeof queryLogs !== 'function') throw new Error('createPianoKioskIdleCheck requires queryLogs');
  if (typeof readScreenOn !== 'function') throw new Error('createPianoKioskIdleCheck requires readScreenOn');
  const lastSeen = async (event) => {
    const rows = await queryLogs(
      `_time:${GAME_MAX_AGE} AND context.app:piano-kiosk AND "${event}" | sort by (_time desc) | limit 1`,
    );
    return rows[0]?._time ? parseTime(rows[0]._time) : null;
  };
  return async function checkPianoKioskIdle() {
    const [mountedAt, unmountedAt, screenOn, recent] = await Promise.all([
      lastSeen('game.mount'),
      lastSeen('game.unmount'),
      readScreenOn(),
      queryLogs(`_time:${ACTIVITY_WINDOW} AND context.app:piano-kiosk`),
    ]);
    if (mountedAt !== null && (unmountedAt === null || mountedAt > unmountedAt)) {
      return { idle: false, reason: 'game' };
    }
    if (recent.some((row) => !BACKGROUND_EVENTS.has(row._msg))) return { idle: false, reason: 'activity' };
    // A hidden page goes quiet by design; a visible one logs about once a minute.
    if (screenOn !== false && !recent.some((row) => row._msg === TELEMETRY_EVENT)) {
      return { idle: false, reason: 'no-telemetry' };
    }
    return { idle: true, reason: null };
  };
}
