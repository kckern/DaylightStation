/**
 * Pure deferral rule for fire toasts. No React — trivially unit-testable,
 * consumed by FitnessContext (the same shape as fitnessToastSlot.js).
 *
 * Fire waits its turn. A challenge celebration or ring card already on screen
 * keeps it, and the queued person is shown the moment the slot clears — so
 * nobody's moment gets stomped and nobody's moment gets silently dropped.
 * One at a time: two people crossing together get a toast each, in order,
 * rather than being merged into a single card.
 *
 * @param {Object} args
 * @param {Object|null} args.currentToast - the toast presently occupying the slot
 * @param {Array<{userId:string,name:string}>} [args.queue] - people waiting
 * @returns {{ show: Object|null, queue: Array }} entry to show now, and the rest
 */
export function planFireToasts({ currentToast, queue } = {}) {
  const waiting = Array.isArray(queue) ? queue : [];
  if (currentToast || waiting.length === 0) {
    return { show: null, queue: [...waiting] };
  }
  return { show: waiting[0], queue: waiting.slice(1) };
}

export default planFireToasts;
