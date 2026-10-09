// Mid-race crash-recovery checkpoint (audit C1): a reload/crash mid-race must
// not discard the whole race. The container periodically writes a snapshot
// (raceMeta + the engine's already-serializable state) here; on next mount,
// a fresh checkpoint is finalized into a saved race record instead of being
// silently lost.
//
// Pure — storage is injected (sessionStorage-shaped: getItem/setItem/removeItem)
// so this is unit-testable without a DOM, and never logs (the caller owns
// telemetry; see CycleGameContainer's cycle_game.race_recovered).

const CHECKPOINT_KEY = 'cycleGame.checkpoint';
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Persist a checkpoint. Swallows any storage error (quota exceeded, storage
 * unavailable, circular data) — a failed checkpoint write must never break
 * the race in progress.
 */
export function writeCheckpoint(store, { raceMeta, engineState, savedAt } = {}) {
  if (!store) return;
  try {
    store.setItem(CHECKPOINT_KEY, JSON.stringify({ raceMeta, engineState, savedAt }));
  } catch {
    // quota exceeded / storage unavailable — best-effort only, never throw.
  }
}

/**
 * Read a checkpoint if it exists, parses, carries the required fields, and is
 * within maxAgeMs of nowMs. Returns null for anything else (missing, corrupt
 * JSON, stale, or missing raceMeta.raceId / engineState.riders).
 */
export function readFreshCheckpoint(store, nowMs, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(CHECKPOINT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const { raceMeta, engineState, savedAt } = parsed || {};
  if (!raceMeta || !raceMeta.raceId) return null;
  if (!engineState || !engineState.riders) return null;
  if (!Number.isFinite(savedAt)) return null;
  if (nowMs - savedAt > maxAgeMs) return null;
  return { raceMeta, engineState, savedAt };
}

/** Remove the checkpoint, if any. Swallows storage errors. */
export function clearCheckpoint(store) {
  if (!store) return;
  try {
    store.removeItem(CHECKPOINT_KEY);
  } catch {
    // best-effort only.
  }
}

export default { writeCheckpoint, readFreshCheckpoint, clearCheckpoint };
