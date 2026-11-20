// Pure builders for the Bluetooth controller-management bus messages the
// frontend publishes. Kept pure + separate so they're unit-testable without
// React or the WebSocket service.

// A pairing window waits this long for the pad to appear in pairing mode —
// long enough to read the steps and press the buttons.
export const PAIR_WINDOW_MS = 60000;

/**
 * @param {object} p
 * @param {string} p.requestId
 * @param {number} [p.durationMs]
 * @param {Array<object>} [p.targets]  from input.yml controllers (pairingGuide.buildPairTargets):
 *   [{ id, label, name, macPrefix, pin }] — what the garage box looks for and the PIN it answers with.
 * @param {'repair'|'add'} [p.mode]  `repair` (default) re-pairs a configured controller; `add` looks
 *   for any new input device and never touches an existing bond. Anything else is `repair`.
 */
export function buildPairRequest({ requestId, durationMs = PAIR_WINDOW_MS, targets = [], mode = 'repair' }) {
  return {
    topic: 'bt.pair.request', requestId, durationMs,
    targets: Array.isArray(targets) ? targets : [],
    mode: mode === 'add' ? 'add' : 'repair',
  };
}
/**
 * Next pairing state for a `bt.pair.progress` message. Only the first message
 * of a window carries `mode`, so later messages of the same request keep the
 * mode already held; a different request never inherits it.
 *
 * @param {object|null} cur   current pairing state.
 * @param {object} data       the progress message.
 */
export function mergePairingProgress(cur, data) {
  const sameRequest = data?.requestId != null && cur?.requestId === data.requestId;
  return { ...data, mode: data?.mode ?? (sameRequest ? cur?.mode : undefined) };
}
export function buildRemoveRequest({ requestId, address }) {
  return { topic: 'bt.remove', requestId, address };
}
