export const PIANO_HEALTH = Object.freeze(['connecting', 'ready', 'input-only', 'output-only', 'offline']);

export function derivePianoHealth({ midiHealth, status, bridgeLink, bridgeUnavailable }) {
  const input = midiHealth?.in === 'bridge' || midiHealth?.in === 'webmidi';
  const output = midiHealth?.out === 'up';
  if (input && output) return 'ready';
  if (input) return 'input-only';
  if (output) return 'output-only';
  const bridgePending = !bridgeUnavailable && ['idle', 'connecting', 'reconnecting'].includes(bridgeLink);
  return status === 'idle' || status === 'requesting' || bridgePending ? 'connecting' : 'offline';
}

export const pianoHealthCopy = (state) => ({
  connecting: 'connecting',
  ready: 'ready',
  'input-only': 'keys connected, Sound controls unavailable',
  'output-only': 'Sound controls connected, piano keys unavailable',
  offline: 'offline',
}[state] || 'offline');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForFreshReady({ getSnapshot, afterGeneration, timeoutMs = 8000, pollMs = 100, sleep = delay }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = getSnapshot();
    if (snapshot.generation > afterGeneration && snapshot.health === 'ready') return snapshot;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return null;
}

/** Pure repair sequence; the provider supplies live transports and state readers. */
export async function runPianoRepair({
  attemptId, bridgeAvailable, resetBridge, reacquireMidi, getSnapshot,
  reassertSound, reassertLevel, waitForReady = waitForFreshReady, now = Date.now,
}) {
  const startedAt = now();
  const base = { attemptId, bridgeReset: bridgeAvailable ? 'pending' : 'skipped', reasserted: false };
  if (bridgeAvailable) {
    let bridge;
    try { bridge = await resetBridge(); }
    catch (error) { bridge = { ok: false, reason: 'request-failed', error: error?.message }; }
    if (!bridge.ok) return { ...base, ok: false, phase: 'bridge-reset', reason: bridge.reason, bridgeReset: 'failed', health: getSnapshot().health, elapsedMs: now() - startedAt };
    base.bridgeReset = 'succeeded';
  }
  const beforeGeneration = getSnapshot().generation;
  let reacquired;
  try { reacquired = await reacquireMidi(); }
  catch (error) { reacquired = { ok: false, reason: 'midi-reacquire-failed', error: error?.message }; }
  if (reacquired?.ok === false) return { ...base, ok: false, phase: 'midi-reacquire', reason: reacquired.reason || 'midi-reacquire-failed', health: getSnapshot().health, elapsedMs: now() - startedAt };
  let ready;
  try { ready = await waitForReady({ getSnapshot, afterGeneration: beforeGeneration }); }
  catch { ready = null; }
  if (!ready) return { ...base, ok: false, phase: 'health-wait', reason: 'health-timeout', health: getSnapshot().health, elapsedMs: now() - startedAt };
  try {
    reassertSound();
    reassertLevel();
  } catch (error) {
    return { ...base, ok: false, phase: 'reassert', reason: 'reassert-failed', error: error?.message, health: ready.health, elapsedMs: now() - startedAt };
  }
  return { ...base, ok: true, phase: 'complete', reason: 'ready', reasserted: true, health: ready.health, elapsedMs: now() - startedAt };
}
