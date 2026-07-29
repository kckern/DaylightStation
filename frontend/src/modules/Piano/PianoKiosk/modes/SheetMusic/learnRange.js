// learnRange.js — pure auto-range heuristic for the Learn landing (wave-3 B).
import { sectionToRange } from './focusRange.js';
import { expectedMidisAtStep } from './activeParts.js';

const clip = (m, max) => Math.max(0, Math.min(m, max));

/** Measures with ≥1 expected note for the ACTIVE hands. */
function hasActiveNotes(measure, steps, activeParts) {
  for (let i = measure.firstStep; i <= measure.lastStep; i++) {
    if (expectedMidisAtStep(steps?.[i], activeParts || {}).size > 0) return true;
  }
  return false;
}
function hasAnyNotes(measure, steps) {
  for (let i = measure.firstStep; i <= measure.lastStep; i++) {
    if ((steps?.[i]?.notes || []).length > 0) return true;
  }
  return false;
}

export function pickLearnRange({ sections = [], measures = [], steps = [], activeParts = {}, passesByMeasure = null, windowSize = 4, passThreshold = 3 }) {
  const n = measures.length;
  if (!n) return { inMeasure: 0, outMeasure: 0, reason: 'whole' };
  const last = n - 1;
  const active = measures.map((m) => hasActiveNotes(m, steps, activeParts));

  // 1 · history frontier: a window ANCHORED at the first under-practiced playable
  // measure — trouble pins the window's start, not a window-scan boundary (an
  // outer loop over window-start `i` would land the window one measure early
  // whenever the trouble measure sits mid-window instead of at its front).
  if (Array.isArray(passesByMeasure)) {
    for (let m = 0; m <= last; m++) {
      if (active[m] && (passesByMeasure[m] ?? 0) < passThreshold) {
        return { inMeasure: m, outMeasure: clip(m + windowSize - 1, last), reason: 'frontier' };
      }
    }
  }

  // 2 · first rehearsal section.
  for (const s of sections) {
    const r = sectionToRange(s, measures);
    if (r) return { ...r, reason: 'section' };
  }

  // 3 · density floor: first window where EVERY measure is playable by the active hands.
  for (let i = 0; i + windowSize - 1 <= last; i++) {
    let ok = true;
    for (let m = i; m < i + windowSize; m++) if (!active[m]) { ok = false; break; }
    if (ok) return { inMeasure: i, outMeasure: i + windowSize - 1, reason: 'density' };
  }

  // 4 · first non-empty run (any staff), else the whole piece.
  const firstNotes = measures.findIndex((m) => hasAnyNotes(m, steps));
  if (firstNotes >= 0) return { inMeasure: firstNotes, outMeasure: clip(firstNotes + windowSize - 1, last), reason: 'fallback' };
  return { inMeasure: 0, outMeasure: last, reason: 'whole' };
}

export default { pickLearnRange };
