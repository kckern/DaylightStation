/**
 * Spec §8 `item.stalled` (warn): fires once at 45 s and again at 120 s.
 * The timer itself is shared with the sentence ladder — see
 * `shared/useInputStall.js`.
 */
export { STALL_MS, useInputStall as useItemStall, default } from '../../shared/useInputStall.js';
