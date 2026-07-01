// cli/midi-ingest/harmonicClassify.mjs
// Infer a loop's implied harmony from its notes. Windows notes by bar, picks the
// most likely chord per bar, then delegates to shared roman analysis. Uncertain
// by nature (esp. for bare melodies) — callers should gate on the confidence.
import { mod12 } from '../../shared/music/transpose.mjs';
import { romanAnalysis, bestTonic } from '../../shared/music/romanAnalysis.mjs';
import { signatureKey } from '../../shared/music/harmonicSignature.mjs';

/** Pitch-class set of notes sounding in each bar. */
export function windowChords(notes, { ppq, beats = 4, beatType = 4 }) {
  if (!notes?.length) return [];
  const barTicks = ppq * (4 / beatType) * beats;
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const barCount = Math.max(1, Math.ceil(end / barTicks));
  const bars = Array.from({ length: barCount }, () => new Set());
  for (const n of notes) {
    const bar = Math.min(barCount - 1, Math.floor(n.ticks / barTicks));
    bars[bar].add(mod12(n.midi));
  }
  return bars.filter((s) => s.size > 0);
}

const TRIADS = [
  { quality: 'major', intervals: [0, 4, 7] },
  { quality: 'minor', intervals: [0, 3, 7] },
  { quality: 'diminished', intervals: [0, 3, 6] },
  { quality: 'augmented', intervals: [0, 4, 8] },
];

/** Best-fitting root+quality for a pitch-class set, or null if nothing fits. */
export function pcSetToTriad(pcSet) {
  if (!pcSet || pcSet.size < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root += 1) {
    for (const { quality, intervals } of TRIADS) {
      const triad = intervals.map((i) => (root + i) % 12);
      const present = triad.filter((pc) => pcSet.has(pc)).length;
      const extra = [...pcSet].filter((pc) => !triad.includes(pc)).length;
      const score = present * 2 - extra;
      if (present >= 2 && (!best || score > best.score)) best = { root, quality, score };
    }
  }
  return best ? { root: best.root, quality: best.quality } : null;
}

/**
 * Infer a loop's harmony from its notes.
 * @returns {{roman:string[]|null, barSpan:number, signature:string|null, confidence:number}}
 */
export function classifyHarmony(notes, timeSig) {
  const windows = windowChords(notes, timeSig);
  const triads = windows.map(pcSetToTriad);
  const resolved = triads.filter(Boolean);
  const barSpan = windows.length;
  if (resolved.length === 0) return { roman: null, barSpan, signature: null, confidence: 0 };
  const tonic = bestTonic(resolved);
  const roman = triads.map((t) => (t ? romanAnalysis([t], tonic)[0] : '?'));
  const confidence = resolved.length / triads.length;
  return { roman, barSpan, signature: signatureKey(roman.filter((r) => r !== '?')), confidence };
}
