/**
 * memoryPredicates — pure predicate evaluation for memory-watch rules.
 *
 * A `when` clause is an object of conditions. ALL present (recognized) keys
 * must hold for the predicate to fire (logical AND). An empty or null clause
 * never fires — a watch with no condition is inert by design.
 */

/**
 * Evaluate a memory-watch predicate.
 * @param {object|null} when condition object (equals/changed/gt/lt/mask)
 * @param {number} value current memory value
 * @param {number} [prevValue] previous memory value (for `changed`)
 * @returns {boolean}
 */
export function evalPredicate(when, value, prevValue) {
  if (!when || typeof when !== 'object') return false;

  let recognized = 0;

  if ('equals' in when) {
    recognized++;
    if (value !== when.equals) return false;
  }
  if ('changed' in when && when.changed === true) {
    recognized++;
    if (value === prevValue) return false;
  }
  if ('gt' in when) {
    recognized++;
    if (!(value > when.gt)) return false;
  }
  if ('lt' in when) {
    recognized++;
    if (!(value < when.lt)) return false;
  }
  if ('mask' in when) {
    recognized++;
    if ((value & when.mask) === 0) return false;
  }

  // No recognized predicate keys (e.g. {} or only unknown keys) => never fires.
  if (recognized === 0) return false;

  return true;
}
