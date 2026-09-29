export const BROWSER_UNCERTAIN_AFTER_MS = 120_000;

const ORDER = new Map([
  ['playing', 0], ['buffering', 0], ['stalled', 0],
  ['paused', 1], ['loading', 2], ['idle', 3], ['stopped', 3],
  ['uncertain', 4], ['off', 5], ['unknown', 6],
]);

export function browserDisplayState({ connected, lastHeardMs = Infinity, state = 'unknown' } = {}) {
  if (connected === true) return state === 'stopped' ? 'idle' : state;
  if (lastHeardMs > BROWSER_UNCERTAIN_AFTER_MS) return 'uncertain';
  return ['playing', 'paused', 'buffering', 'stalled', 'loading'].includes(state)
    ? 'idle'
    : (state === 'stopped' ? 'idle' : state);
}

/** Merge the authoritative live snapshot into every configured fleet row. */
export function mergeCanonicalFleetState(devices, entries) {
  return devices.map(device => {
    const entry = entries.get(device.id);
    const state = entry?.offline === true
      ? 'off'
      : (entry?.snapshot?.state ?? device.state ?? 'unknown');
    return { ...device, state, displayState: state };
  });
}

export function sortFleetDevices(devices) {
  return [...devices].sort((left, right) => {
    const rank = (ORDER.get(left.displayState ?? left.state) ?? 99) - (ORDER.get(right.displayState ?? right.state) ?? 99);
    return rank || String(left.name ?? left.id).localeCompare(String(right.name ?? right.id));
  });
}
