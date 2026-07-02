// Harmonic timeline — beat-resolution pitch-class occupancy for a loop. Pure,
// no DOM. Foundation for the union-consonance stackability guardrail and the
// loop-library enrichment CLI: given raw notes, it answers "which pitch classes
// sound on which beat, relative to the loop's root, and how harmonically dense
// is the densest moment?".
//
// Deliberately strict and deterministic: no probabilistic key-finding. Ambiguous
// loops are the caller's problem (the enrichment CLI flags them); this module
// applies one documented heuristic and always returns the same answer.

import { mod12 } from './transpose.mjs';
import { loopLengthTicks } from './loopScheduler.mjs';

/**
 * Detect the loop's root pitch class (0..11, absolute).
 *
 * Heuristic (simple + deterministic, documented over clever): each pitch class
 * scores its total sounding duration in ticks, with a 1.5x weight for notes that
 * start exactly on a slot (beat) boundary. Ties break toward the pitch class of
 * the lowest note sounding in slot 0 (the bass anchor); remaining ties fall to
 * the lower pitch class. Zero-duration notes score nothing, so a loop of only
 * percussive hits resolves entirely via the bass anchor.
 *
 * Note: `romanAnalysis.bestTonic` is NOT reused here — it key-finds over parsed
 * chord symbols, whereas this operates on raw notes with no chord labels.
 *
 * @param {Array<{ticks:number,durationTicks:number,midi:number}>} notes
 * @param {number} slotTicks ticks per slot (beat)
 * @returns {number} pitch class 0..11
 */
function detectRoot(notes, slotTicks) {
  const score = new Array(12).fill(0);
  for (const n of notes) {
    const pc = mod12(n.midi);
    const dur = n.durationTicks || 0;
    const onBeat = n.ticks % slotTicks === 0;
    score[pc] += onBeat ? dur * 1.5 : dur;
  }

  // Bass anchor: pitch class of the lowest note that starts within slot 0.
  let bassPc = null;
  let bassMidi = Infinity;
  for (const n of notes) {
    if (n.ticks < slotTicks && n.midi < bassMidi) {
      bassMidi = n.midi;
      bassPc = mod12(n.midi);
    }
  }

  let root = 0;
  for (let pc = 1; pc < 12; pc += 1) {
    if (score[pc] > score[root]) root = pc;
    else if (score[pc] === score[root] && pc === bassPc) root = pc;
  }
  return root;
}

/**
 * Grade the loop's densest harmonic content from its root-relative slot sets.
 * - every sounding pc is the root ({0})            → 'root'
 * - every sounding pc is root or fifth (⊆ {0,7})   → 'fifth' (strict — no inversion tolerance)
 * - max slot cardinality ≤ 3 distinct pcs          → 'triad'
 * - any slot with ≥ 4 distinct pcs                 → 'extended'
 * @param {number[][]} slots root-relative pc sets
 * @returns {'root'|'fifth'|'triad'|'extended'}
 */
function gradeSpecificity(slots) {
  let maxCardinality = 0;
  const union = new Set();
  for (const set of slots) {
    maxCardinality = Math.max(maxCardinality, set.length);
    for (const pc of set) union.add(pc);
  }
  if (union.size === 0 || (union.size === 1 && union.has(0))) return 'root';
  if ([...union].every((pc) => pc === 0 || pc === 7)) return 'fifth';
  return maxCardinality <= 3 ? 'triad' : 'extended';
}

/**
 * Extract the harmonic timeline of a loop: one pitch-class set per slot (a slot
 * = one beat at the default 4 slots per 4/4 bar), spanning the loop's whole-bar
 * length (via `loopLengthTicks`, so it matches the scheduler's cycle length).
 *
 * A note contributes its pitch class (midi % 12) to every slot it sounds in —
 * from its start slot through the slot containing its end, EXCLUSIVE of a
 * boundary-exact end (a half note ending on beat 3's downbeat does not bleed
 * into beat 3). Zero-duration notes register in their start slot only.
 *
 * Slot sets are normalized relative to the detected root — stored as
 * `(pc - root + 12) % 12`, deduped, sorted ascending — while `root` reports the
 * absolute pitch class. See `detectRoot` for the (deterministic) heuristic.
 *
 * Degenerate input (no notes) returns `{ slots: [], root: 0, specificity: 'root' }`.
 *
 * @param {Array<{ticks:number,durationTicks:number,midi:number}>} notes
 * @param {number} ppq ticks per quarter note
 * @param {{slotsPerBar?:number, timeSig?:[number,number]}} [opts]
 * @returns {{slots:number[][], root:number, specificity:'root'|'fifth'|'triad'|'extended'}}
 */
export function harmonicTimeline(notes, ppq, opts = {}) {
  const { slotsPerBar = 4, timeSig = [4, 4] } = opts;
  if (!Array.isArray(notes) || notes.length === 0) {
    return { slots: [], root: 0, specificity: 'root' };
  }

  const [beats, beatType] = timeSig;
  const barTicks = ppq * (4 / beatType) * beats;
  const slotTicks = barTicks / slotsPerBar;
  const totalTicks = loopLengthTicks(notes, ppq, { beats, beatType });
  const slotCount = Math.round(totalTicks / slotTicks);

  const occupancy = Array.from({ length: slotCount }, () => new Set());
  for (const n of notes) {
    const startSlot = Math.floor(n.ticks / slotTicks);
    const end = n.ticks + (n.durationTicks || 0);
    // ceil() makes a boundary-exact end exclusive; max() keeps zero-duration
    // (and sub-slot) notes registering in their start slot.
    const endSlot = Math.max(startSlot + 1, Math.ceil(end / slotTicks));
    for (let s = startSlot; s < Math.min(endSlot, slotCount); s += 1) {
      occupancy[s].add(mod12(n.midi));
    }
  }

  const root = detectRoot(notes, slotTicks);
  const slots = occupancy.map((set) => [...set].map((pc) => mod12(pc - root)).sort((a, b) => a - b));
  return { slots, root, specificity: gradeSpecificity(slots) };
}

export default harmonicTimeline;
