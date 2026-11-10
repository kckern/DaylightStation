/**
 * Skip inference — a screen that moves on from an unfinished item, and never
 * comes back to it, has been skipped forward by the viewer.
 *
 * The play/log heartbeat carries no skip reason and the player has many ways
 * to advance (keys, remote, Skip pill, external advance), so the decision is
 * made where they all converge: the per-screen heartbeat stream.
 *
 * A transition only makes the old item a *pending* skip. It is confirmed once
 * the old item has stayed silent for SKIP_CONFIRM_MS, and cancelled the moment
 * it reports again — a screen running two players (a readalong over ambient
 * music) alternates heartbeats and must never skip either.
 *
 * Never a skip: a finished item moving on (natural end), a screen that went
 * quiet (TV off — no next heartbeat), or a next item that arrives after
 * SKIP_WINDOW_MS (came back later).
 *
 * Pure reducer: (state, heartbeat) -> { state, skips }.
 */
export const SKIP_WINDOW_MS = 2 * 60 * 1000;
export const SKIP_CONFIRM_MS = 30 * 1000;

/**
 * @param {{last: Object|null, pending: Array}|null} state
 * @param {{assetId: string, storagePath: string, complete: boolean, atEpoch: number}} beat
 * @returns {{state: {last: Object, pending: Array}, skips: Array<{assetId: string, storagePath: string}>}}
 */
export function observeHeartbeat(state, beat) {
  const last = state?.last ?? null;
  // A pending item that reports again was never skipped.
  let pending = (state?.pending ?? []).filter(p => p.assetId !== beat.assetId);

  if (last && last.assetId !== beat.assetId && !last.complete
    && beat.atEpoch - last.atEpoch <= SKIP_WINDOW_MS
    && !pending.some(p => p.assetId === last.assetId)) {
    pending.push({ assetId: last.assetId, storagePath: last.storagePath, since: beat.atEpoch });
  }

  const due = pending.filter(p => beat.atEpoch - p.since >= SKIP_CONFIRM_MS);
  pending = pending.filter(p => !due.includes(p));

  return {
    state: { last: { ...beat }, pending },
    skips: due.map(p => ({ assetId: p.assetId, storagePath: p.storagePath })),
  };
}
