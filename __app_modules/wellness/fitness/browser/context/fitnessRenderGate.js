/**
 * Sensor render gate — does this packet change anything on screen?
 *
 * ANT+ sensors broadcast at ~4 Hz and the garage hears every packet on two
 * dongles, so most packets repeat the last reading exactly. Before this gate
 * every packet scheduled a provider re-render, which filled every 250 ms
 * throttle window: ~110 provider renders per 30 s with a single strap, enough
 * to trip `fitness-profile-excessive-renders` in every busy session.
 *
 * The signature covers every field a device carries EXCEPT its arrival clocks
 * (which change on every packet by definition), plus the session-level state a
 * packet can move: session start, user/assignment mutations, the zone store's
 * own output signature, and the transport-stall edge. It is deliberately
 * generic over device fields so a field added to Device later is covered
 * without touching this file.
 *
 * The caller keeps a keepalive (`SENSOR_KEEPALIVE_MS`) so that even if some
 * render input is ever missed here, a streaming sensor still re-renders the
 * provider at least once a second.
 */

/** Device fields that change on every packet without changing what is shown. */
const ARRIVAL_CLOCK_FIELDS = new Set([
  'lastSeen',
  'timestamp',
  'lastHeartRateAt',
  'lastSignificantActivity',
  '_isNew',
  '_hrHeld',
]);

/** Re-render at least this often while packets arrive, changed or not. */
export const SENSOR_KEEPALIVE_MS = 1000;

const encode = (value) => {
  if (value === null || typeof value !== 'object') return String(value);
  try { return JSON.stringify(value); } catch { return '?'; }
};

export function sensorRenderSignature(session) {
  const deviceManager = session?.deviceManager;
  const devices = deviceManager?.devices;
  if (!(devices instanceof Map)) return '';
  let signature = [
    session.sessionId ?? '',
    session.isActive ? 1 : 0,
    session.userManager?.mutationVersion ?? '',
    session.zoneProfileStore?._signature ?? '',
    deviceManager._transportStalledSince ?? '',
    devices.size,
  ].join('|');
  for (const device of devices.values()) {
    signature += '#';
    for (const key of Object.keys(device)) {
      if (ARRIVAL_CLOCK_FIELDS.has(key)) continue;
      signature += `${key}=${encode(device[key])};`;
    }
  }
  return signature;
}
