// Pure builders and merges for the Bluetooth bus messages the fitness host
// publishes and receives. Kept pure + separate so they're unit-testable
// without React or the WebSocket service. useFitnessBluetooth.js uses them.

export const PAIR_WINDOW_MS = 60000;   // a configured pad's repair window
export const ADDRESS_PAIR_MS = 30000;  // waiting for one picked device to show up again
export const SCAN_WINDOW_MS = 60000;   // one nearby search
export const SCAN_ANSWER_MS = 8000;    // a current satellite answers a search within this (> its 5 s kill grace)
export const SCAN_END_GRACE_MS = 5000; // a search with no `done` this long after its end time is over
const HEALTH_FRESH_MS = 15000;         // fitness.transport.health arrives every 5 s
const MODES = new Set(['repair', 'address']);

/**
 * @param {object} p
 * @param {string} p.requestId
 * @param {number} [p.durationMs]
 * @param {Array<object>} [p.targets]  repair: [{ id, label, name, macPrefix, pin }];
 *   address: [{ id, label, pin? }] for the matched input.yml controller, if any.
 * @param {'repair'|'address'} [p.mode]  anything else (the retired 'add') is repair.
 * @param {string} [p.address]  address mode: the picked device.
 */
export function buildPairRequest({ requestId, durationMs = PAIR_WINDOW_MS, targets = [], mode = 'repair', address }) {
  const m = MODES.has(mode) ? mode : 'repair';
  const msg = { topic: 'bt.pair.request', requestId, durationMs, targets: Array.isArray(targets) ? targets : [], mode: m };
  if (m === 'address') msg.address = String(address || '').toUpperCase();
  return msg;
}

export function buildScanRequest({ requestId, action = 'start', durationMs = SCAN_WINDOW_MS }) {
  return action === 'stop'
    ? { topic: 'bt.scan.request', requestId, action: 'stop' }
    : { topic: 'bt.scan.request', requestId, action: 'start', durationMs };
}

export function buildInventoryRequest({ requestId }) {
  return { topic: 'bt.inventory.request', requestId };
}

export function buildRemoveRequest({ requestId, address }) {
  return { topic: 'bt.remove', requestId, address };
}

/**
 * Next pairing state for a `bt.pair.progress` message. Progress for another
 * request is ignored (a late line from an older window must not overwrite the
 * one the screen is waiting on), except that a new window's `scanning` is
 * adopted once the current one is done (the backend route's repair has no
 * browser request). Within one request the window's mode and the device carry
 * forward, and the last error code carries into `done` only, so `done` still
 * knows who failed and why (a `paired` result drops the code). A current
 * satellite's `scanning` echoes the requested mode; an address request
 * answered by a `scanning` in another mode (or none) met an older satellite,
 * which sets `satelliteOutdated` for the rest of that request.
 */
export function mergePairingProgress(cur, data) {
  const otherRequest = cur?.requestId != null && data?.requestId != null && data.requestId !== cur.requestId;
  if (otherRequest && !(cur.phase === 'done' && data.phase === 'scanning')) return cur;
  const sameRequest = data?.requestId != null && cur?.requestId === data.requestId;
  const next = { ...data, mode: data?.mode ?? (sameRequest ? cur?.mode : undefined) };
  if (data?.code != null) next.lastCode = data.code;
  if (sameRequest) {
    if (next.device == null && cur?.device) next.device = cur.device;
    const succeeded = data?.phase === 'paired' || (Array.isArray(data?.paired) && data.paired.length > 0);
    // The last error code rides along as `lastCode` and surfaces as `code`
    // on `done` only: a live phase after a retry (pairing, passkey) is not an error.
    if (next.code == null && cur?.lastCode) next.lastCode = cur.lastCode;
    if (data?.phase === 'done' && next.code == null && next.lastCode && !succeeded) next.code = next.lastCode;
  }
  const outdated = sameRequest && (
    cur?.satelliteOutdated === true
    || (cur?.mode === 'address' && data?.phase === 'scanning' && data?.mode !== 'address')
  );
  if (outdated) next.satelliteOutdated = true;
  return next;
}

/**
 * Next search state for a `bt.scan.progress` message. Messages from another
 * search are ignored, and so is anything but `done` once a stop was asked.
 * Phases other than scanning/nearby/done (the helper's `warn`) leave it as is.
 *
 * @param {object|null} cur   { phase: 'starting'|'scanning'|'stopping'|'done', requestId, endsAt, devices, reason }
 * @param {object} data
 * @param {number} now        ms clock.
 */
export function mergeScanProgress(cur, data, now) {
  if (!data?.phase) return cur;
  if (cur?.requestId && data.requestId && data.requestId !== cur.requestId) return cur;
  if (cur?.phase === 'stopping' && data.phase !== 'done') return cur;
  if (cur?.phase === 'done' && data.phase !== 'scanning') return cur;
  const base = { ...(cur || {}), requestId: data.requestId ?? cur?.requestId ?? null, optimistic: false };
  if (data.phase === 'scanning') {
    return { ...base, phase: 'scanning', reason: null, endsAt: now + (Number(data.durationMs) || SCAN_WINDOW_MS), devices: cur?.devices || [] };
  }
  if (data.phase === 'nearby') {
    return { ...base, phase: 'scanning', endsAt: cur?.endsAt ?? null, devices: Array.isArray(data.devices) ? data.devices : [] };
  }
  if (data.phase === 'done') return { ...base, phase: 'done', reason: data.reason || null, devices: [] };
  return cur;
}

/** Why a search got no answer: the satellite is alive (so it predates searches) or silent. */
export function scanSilenceReason({ lastHealthAt, now }) {
  return lastHealthAt && now - lastHealthAt < HEALTH_FRESH_MS ? 'satellite-outdated' : 'no-response';
}
