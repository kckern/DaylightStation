// resolveAdvance.js — pure. Collapse the (advance, music, interval) config into a
// single concrete trigger ArtMode acts on. Keeps the smart-fallback logic out of
// the component and unit-testable.
//
// Triggers:
//   'hold'  — art never changes on its own (until remount or a manual skip).
//   'track' — art changes when the background music moves to a new song.
//   'timer' — art changes every intervalMs.
//
// `advance: 'auto'` resolves at runtime per the fallback chain:
//   music present            → 'track'
//   no music + interval set  → 'timer'
//   neither                  → 'hold'
//
// Any explicit value ('hold'|'track'|'timer') is honored as-is; an unknown value
// (or undefined) falls back to 'hold'.
const TRIGGERS = new Set(['hold', 'track', 'timer']);

export function resolveAdvance({ advance = 'hold', hasMusic = false, intervalMs = 0 } = {}) {
  if (advance === 'auto') {
    if (hasMusic) return 'track';
    if (intervalMs > 0) return 'timer';
    return 'hold';
  }
  return TRIGGERS.has(advance) ? advance : 'hold';
}

export default resolveAdvance;
