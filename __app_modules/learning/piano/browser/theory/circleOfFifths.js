// Pure circle-of-fifths model: 12 major-key slots in fifths order, their geometry
// (unit-circle x/y, top = 12 o'clock), and which slots to highlight given the
// active pitch classes (and optionally a detected key region). No SVG / React.

// Fifths order clockwise from the top. Each label's pitchClass is its key root.
// C(0) G(7) D(2) A(9) E(4) B(11) F#(6) Db(1) Ab(8) Eb(3) Bb(10) F(5).
const ORDER_LABELS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const LABEL_TO_PC = { C: 0, G: 7, D: 2, A: 9, E: 4, B: 11, 'F#': 6, Db: 1, Ab: 8, Eb: 3, Bb: 10, F: 5 };

/** The 12 slots in fifths order: { label, pitchClass }. */
export const CIRCLE_ORDER = ORDER_LABELS.map((label) => ({ label, pitchClass: LABEL_TO_PC[label] }));

/**
 * Geometry for each slot: angle (deg, 0 at top, clockwise) + unit x/y
 * (center 0,0, radius 1, top y = -1).
 * @returns {{ label:string, pitchClass:number, angle:number, x:number, y:number }[]}
 */
export function circlePositions() {
  return CIRCLE_ORDER.map((slot, i) => {
    const angle = i * 30; // 360 / 12
    const rad = (angle - 90) * (Math.PI / 180); // -90 so angle 0 sits at the top
    return { ...slot, angle, x: Math.cos(rad), y: Math.sin(rad) };
  });
}

/**
 * Slot indices whose pitch class is currently sounding.
 * @param {number[]} pitchClasses
 * @returns {Set<number>}
 */
export function activeSlots(pitchClasses) {
  const active = new Set((pitchClasses || []).map((pc) => ((pc % 12) + 12) % 12));
  const out = new Set();
  CIRCLE_ORDER.forEach((slot, i) => { if (active.has(slot.pitchClass)) out.add(i); });
  return out;
}

/**
 * The I / IV / V neighbourhood (three adjacent fifths) of a major key, as slot indices.
 * @param {string} keyName e.g. 'C', 'G', 'Bb'
 * @returns {Set<number>}
 */
export function keyArc(keyName) {
  const idx = ORDER_LABELS.indexOf(keyName);
  if (idx < 0) return new Set();
  const left = (idx + ORDER_LABELS.length - 1) % ORDER_LABELS.length; // IV (down a fifth)
  const right = (idx + 1) % ORDER_LABELS.length;                       // V (up a fifth)
  return new Set([left, idx, right]);
}

// The seven diatonic scale degrees of a major key, in fifths order relative to
// the tonic slot: IV·I·V are major, ii·vi·iii minor, vii° diminished. Together
// they occupy seven ADJACENT circle positions (offsets -1..+5), which is why the
// diatonic "window" is a contiguous arc.
const DIATONIC = [
  { offset: -1, roman: 'IV', quality: 'major' },
  { offset: 0, roman: 'I', quality: 'major' },
  { offset: 1, roman: 'V', quality: 'major' },
  { offset: 2, roman: 'ii', quality: 'minor' },
  { offset: 3, roman: 'vi', quality: 'minor' },
  { offset: 4, roman: 'iii', quality: 'minor' },
  { offset: 5, roman: 'vii°', quality: 'diminished' },
];

/** Slot index (0-11) whose key root is pitch class `pc`, or -1 if none. */
export function slotOfPitchClass(pc) {
  if (pc == null || Number.isNaN(pc)) return -1;
  const p = ((Math.trunc(pc) % 12) + 12) % 12;
  return CIRCLE_ORDER.findIndex((s) => s.pitchClass === p);
}

/**
 * The seven diatonic slots of a major key: slotIndex → { roman, quality }.
 * Empty map for an unknown key. Drives the degree ring + chord-quality colouring.
 * @param {string} keyName e.g. 'C', 'G', 'Bb'
 * @returns {Map<number, {roman:string, quality:'major'|'minor'|'diminished'}>}
 */
export function diatonicSlots(keyName) {
  const idx = ORDER_LABELS.indexOf(keyName);
  const m = new Map();
  if (idx < 0) return m;
  const n = ORDER_LABELS.length;
  for (const d of DIATONIC) {
    const slot = (((idx + d.offset) % n) + n) % n;
    m.set(slot, { roman: d.roman, quality: d.quality });
  }
  return m;
}

export default { CIRCLE_ORDER, circlePositions, activeSlots, keyArc, diatonicSlots, slotOfPitchClass };
