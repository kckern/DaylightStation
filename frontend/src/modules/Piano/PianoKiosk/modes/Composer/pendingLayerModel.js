// pendingLayerModel.js — pure grouping logic for PendingLayer.jsx, split out
// so Fast Refresh can hot-reload the layer component on its own.

/**
 * Group indices of SIMULTANEOUS pending notes so their stems can agree.
 *
 * The model's only onset marker is `chord: true`, which means "shares the
 * previous note's onset instead of advancing time" (note.js) — so a simultaneity
 * is a run of one principal followed by its chord members.
 *
 * REALITY CHECK: nothing reaches here with `chord: true` today. useWetInk's
 * pendingAppendDiff bails to a full engrave on any chord member (wetInk.js), and
 * useComposerInput inserts every armed note-on as its own caret-advancing note
 * (no simultaneity window is enacted — see CHORD_ONSET_TOLERANCE_MS). So in
 * practice this returns one singleton group per note and the per-note rule
 * applies. It is written anyway because PendingLayer is pure and the grouping
 * feature is the next step: when chords do arrive, their stems must not each
 * decide independently.
 *
 * @returns {number[][]} one index list per simultaneity, in order.
 */
export function simultaneityRuns(pending = []) {
  const runs = [];
  pending.forEach((n, i) => {
    if (n?.chord && runs.length) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  return runs;
}
