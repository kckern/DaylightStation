export const BROWSER_UNCERTAIN_AFTER_MS = 120_000;

// Ranks below mirror browserDisplayState's own ordering. `ready`/`ended`/
// `error` come from sessionReducer's PLAYER_STATE_MAP and previously had no
// entry here at all, falling through to the `?? 99` default — worse than
// `off` (5) and `unknown` (6), so a live TV that was merely ready, ended, or
// erroring sorted BELOW devices that are off or not configured at all.
// `ready` (loaded, about to play) sits with `paused`; `ended` (finished, but
// was just playing) sits with `idle`/`stopped`; `error` (a real device
// reporting a real problem) still outranks `off`/`unknown` — a device we can
// hear from, even unhappily, is more "there" than one that isn't.
const ORDER = new Map([
  ['playing', 0], ['buffering', 0], ['stalled', 0],
  ['paused', 1], ['ready', 1], ['loading', 2], ['idle', 3], ['stopped', 3], ['ended', 3],
  ['uncertain', 4], ['error', 4], ['off', 5], ['unknown', 6],
]);

export function browserDisplayState({ connected, lastHeardMs = Infinity, state = 'unknown' } = {}) {
  if (connected === true) return state === 'stopped' ? 'idle' : state;
  if (lastHeardMs > BROWSER_UNCERTAIN_AFTER_MS) return 'uncertain';
  return ['playing', 'paused', 'buffering', 'stalled', 'loading'].includes(state)
    ? 'idle'
    : (state === 'stopped' ? 'idle' : state);
}

/**
 * Merge the authoritative live snapshot into every configured fleet row.
 *
 * A configured (physical) device has no WS-level "connected" signal the way
 * a browser tab does — `browserDisplayState`'s `connected` branch doesn't
 * apply to it. Instead this honours the SAME two-minute uncertainty window
 * (`BROWSER_UNCERTAIN_AFTER_MS`) purely from elapsed real time since the last
 * `device-state` broadcast (`lastSeenAt`): the merge trusts the live snapshot
 * fully for up to two minutes of silence — whether that silence is the
 * device itself going quiet or the WS dropping entirely (FleetProvider stops
 * receiving `device-state:*` either way, so `lastSeenAt` simply stops
 * advancing) — then reports `uncertain` once two minutes have actually
 * passed, rather than trusting a stale `playing` forever. `now` is
 * injectable so tests don't need real timers.
 */
export function mergeCanonicalFleetState(devices, entries, { now = Date.now } = {}) {
  return devices.map(device => {
    const entry = entries.get(device.id);
    if (!entry) {
      const state = device.state ?? 'unknown';
      return { ...device, state, displayState: state };
    }
    if (entry.offline === true) {
      return { ...device, state: 'off', displayState: 'off' };
    }
    const rawState = entry.snapshot?.state ?? device.state ?? 'unknown';
    const lastHeardMs = entry.lastSeenAt != null
      ? Math.max(0, now() - new Date(entry.lastSeenAt).getTime())
      : 0;
    // `>=` (not `>`): a re-render timer firing exactly at the boundary must
    // flip this, not wait for a strictly-later tick.
    const state = lastHeardMs >= BROWSER_UNCERTAIN_AFTER_MS ? 'uncertain' : rawState;
    return { ...device, state, displayState: state };
  });
}

export function sortFleetDevices(devices) {
  return [...devices].sort((left, right) => {
    const rank = (ORDER.get(left.displayState ?? left.state) ?? 99) - (ORDER.get(right.displayState ?? right.state) ?? 99);
    return rank || String(left.name ?? left.id).localeCompare(String(right.name ?? right.id));
  });
}
