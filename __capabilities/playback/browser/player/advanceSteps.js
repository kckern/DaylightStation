// __capabilities/playback/browser/player/advanceSteps.js
// How the Player handle's advance(count) becomes queue moves.
//
// A forward move of several entries is ONE move: every queue move goes through
// the surround's change curtain, and N single moves shut it N times. The queue
// controller's advance(step) already slices `step` entries at once. The
// exception is an on-deck item, which advance() plays first and which consumes
// a step, so with one waiting the steps stay single.
//
// A batched move is used only while the step lands inside the queue
// (step < queueLength). At the queue's end the two differ: single steps past
// the last entry end a non-continuous queue, where one sliced move stops on
// the last item; and a one-entry continuous queue resets to the original
// queue on its first step and rotates on the rest, where one move only
// resets. With an unknown length the steps stay single.

/**
 * @param {number|undefined} count entries to move; negative backtracks.
 * @param {{isQueue:boolean, hasOnDeck:boolean, queueLength?:number|null, advance?:Function|null, singleAdvance?:Function|null}} ctx
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
