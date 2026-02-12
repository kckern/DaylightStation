/**
 * resolveProgressConflict — Pure domain function
 *
 * Determines which progress source (local DS or remote ABS) wins when
 * the two disagree at play start.
 *
 * Rules (evaluated in order):
 *   1. Null handling — if either side is null, use the one that exists
 *   2. Sanity guard — reject a zero playhead when the other side is > 60s
 *   3. Finished propagation — finished state always wins
 *   4. Latest timestamp wins — compare lastPlayed (ISO) vs lastUpdate (epoch)
 *   5. Tie-breaker — furthest playhead; full tie prefers local
 *
 * @param {Object|null} local  - { playhead, duration, isWatched, lastPlayed, watchTime }
 * @param {Object|null} remote - { currentTime, isFinished, lastUpdate, duration }
 * @returns {{ playhead: number, duration: number, isFinished: boolean, source: 'local'|'remote' } | null}
 */
export function resolveProgressConflict(local, remote) {
  const hasLocal = local != null;
  const hasRemote = remote != null;

  // ── Rule 1: Null handling ────────────────────────────────────────
  if (!hasLocal && !hasRemote) return null;
  if (!hasLocal) return formatRemote(remote);
  if (!hasRemote) return formatLocal(local);

  // Normalize playheads for comparison
  const localPlayhead = local.playhead ?? 0;
  const remotePlayhead = remote.currentTime ?? 0;

  // ── Rule 2: Sanity guard ─────────────────────────────────────────
  // If one side reports 0 but the other has meaningful progress (> 60s),
  // the zero is stale/uninitialized — reject it.
  const ZERO_THRESHOLD = 60;

  if (localPlayhead === 0 && remotePlayhead > ZERO_THRESHOLD) {
    return formatRemote(remote);
  }
  if (remotePlayhead === 0 && localPlayhead > ZERO_THRESHOLD) {
    return formatLocal(local);
  }

  // ── Rule 3: Finished propagation ─────────────────────────────────
  const localFinished = !!local.isWatched;
  const remoteFinished = !!remote.isFinished;

  if (localFinished && !remoteFinished) return formatLocal(local);
  if (remoteFinished && !localFinished) return formatRemote(remote);
  // If both finished, fall through to timestamp/tie-breaker to pick which playhead

  // ── Rule 4: Latest timestamp wins ────────────────────────────────
  const localEpoch = local.lastPlayed ? new Date(local.lastPlayed).getTime() : null;
  const remoteEpoch = remote.lastUpdate != null ? remote.lastUpdate * 1000 : null;

  if (localEpoch != null && remoteEpoch != null) {
    if (localEpoch > remoteEpoch) return formatLocal(local);
    if (remoteEpoch > localEpoch) return formatRemote(remote);
    // Equal timestamps — fall through to tie-breaker
  } else if (localEpoch != null && remoteEpoch == null) {
    return formatLocal(local);
  } else if (remoteEpoch != null && localEpoch == null) {
    return formatRemote(remote);
  }
  // Both timestamps missing — fall through to tie-breaker

  // ── Rule 5: Tie-breaker — furthest playhead, prefer local on full tie
  if (remotePlayhead > localPlayhead) return formatRemote(remote);
  return formatLocal(local);  // local wins ties
}

/** Format local progress into the canonical output shape. */
function formatLocal(local) {
  return {
    playhead: local.playhead ?? 0,
    duration: local.duration ?? 0,
    isFinished: !!local.isWatched,
    source: 'local',
  };
}

/** Format remote (ABS) progress into the canonical output shape. */
function formatRemote(remote) {
  return {
    playhead: remote.currentTime ?? 0,
    duration: remote.duration ?? 0,
    isFinished: !!remote.isFinished,
    source: 'remote',
  };
}

export default resolveProgressConflict;
