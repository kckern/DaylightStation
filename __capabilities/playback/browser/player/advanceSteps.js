// __capabilities/playback/browser/player/advanceSteps.js
// How the Player handle's advance(count) becomes queue moves.
//
// A forward move of several entries is ONE move: every queue move goes through
// the surround's change curtain, and N single moves shut it N times. The queue
// controller's advance(step) already slices `step` entries at once. With an
// item on deck the steps stay single, which keeps the existing behaviour: the
// move plays the on-deck item. (Each looped advance() reads the same
// render-time on-deck item, so advance(2) then moves one entry, as before.)
//
// A batched move is used only while the step lands inside the queue
// (step < queueLength). At the queue's end the two differ: single steps past
// the last entry end a non-continuous queue, where one sliced move stops on
// the last item; and a one-entry continuous queue resets to the original
// queue on its first step and rotates on the rest, where one move only
// resets. With an unknown length the steps stay single.

/**
 * @param {number|undefined} count entries to move; negative backtracks. It is
 *   truncated toward zero; a missing, zero or non-numeric count is one step.
 *   A single (non-queue) item has no backtrack: a negative count advances once.
 * @param {{isQueue:boolean, hasOnDeck:boolean, queueLength?:number|null, advance?:Function|null, singleAdvance?:Function|null}} ctx
 *   queueLength must be the current playQueue length, with the playing item at
 *   index 0: a step batches only when it lands inside it (step < queueLength).
 */
export function advanceSteps(count, { isQueue, hasOnDeck, queueLength, advance, singleAdvance }) {
  const n = Math.trunc(Number(count));
  const step = Number.isFinite(n) && n !== 0 ? n : 1;
  const fn = isQueue ? advance : singleAdvance;
  if (typeof fn !== 'function') return;
  const batchForward = step > 1 && !hasOnDeck
    && Number.isInteger(queueLength) && step < queueLength;
  if (isQueue && (step < 0 || batchForward)) {
    fn(step);
    return;
  }
  for (let i = 0; i < Math.max(1, step); i += 1) fn();
}
