// editor.js — EditorState + pure editing commands.
//
// EditorState wraps a Score document (Units 2-5) with interactive editing state.
// Every command is a PURE function returning a NEW state; it never mutates the
// input state or its score. Immutability is achieved by deep-copying only the
// path down to the mutation (spreads) or by cloning the whole score for
// larger structural edits.
import { makeNote, noteDivisions } from './note.js';
import { DIVISIONS, decomposeDuration } from '#frontend/modules/MusicNotation/duration.js';
import { serializeMusicXml } from '#frontend/modules/MusicNotation/serializeMusicXml.js';

/** Deep clone a score for structural edits. structuredClone handles the plain
 *  data shapes we use (no functions/DOM). */
function cloneScore(score) {
  return structuredClone(score);
}

/**
 * Capacity of one bar in divisions for a given time signature.
 * 4/4 → 4 * (24 * 4 / 4) = 96. Reused by insertNote and later commands (Unit 8).
 */
export function barCapacity(timeSig) {
  return timeSig.beats * ((DIVISIONS * 4) / timeSig.beatType);
}

/**
 * Sum of the non-chord note durations already in a measure (divisions).
 * Chord notes share their principal's onset, so they don't consume bar time.
 * Reused by insertNote and later commands (Unit 8).
 */
export function measureFill(measure) {
  return measure.notes.reduce((sum, n) => (n.chord ? sum : sum + noteDivisions(n)), 0);
}

/**
 * Wrap a score in a fresh EditorState.
 *
 * Load-adapter reconcile: parseMusicXml produces a score with `composer` (not
 * `composerName`) and stores clefs under `part.clefs`, so a parsed score does
 * not match the shape makeEmptyScore uses. Normalize a CLONE (never mutate the
 * passed-in score) so the editor always sees a consistent shape:
 *   - composerName ← composer when composerName is absent
 *   - divisions defaults to DIVISIONS (24)
 *   - clef defaults from parts[0].clefs[1], else {sign:'G', line:2}
 */
export function initEditor(score) {
  const s = cloneScore(score);
  if (s.composerName === undefined && s.composer !== undefined) {
    s.composerName = s.composer ?? '';
  }
  if (s.divisions === undefined) s.divisions = DIVISIONS;
  if (s.clef === undefined) {
    s.clef = s.parts?.[0]?.clefs?.[1] ?? { sign: 'G', line: 2 };
  }
  return {
    score: s,
    caret: { measureIdx: 0, noteIdx: 0 },
    selection: null,
    armed: false,
    stickyDuration: { type: 'quarter', dots: 0, triplet: false },
    dirty: false,
    revision: 0,
  };
}

/** serialize the editor's score to MusicXML. */
export function serializeFromEditor(state) {
  return serializeMusicXml(state.score);
}

/**
 * Replace the pitch of the note at {measureIdx, noteIdx}, preserving its
 * duration/flags. Immutable: deep-copies the path down to the replaced note.
 */
export function replacePitch(state, { measureIdx, noteIdx }, pitch) {
  const part0 = state.score.parts[0];
  const measure = part0.measures[measureIdx];
  const old = measure.notes[noteIdx];
  const rebuilt = makeNote(pitch, {
    type: old.type, dots: old.dots, tie: old.tie, triplet: old.triplet,
    chord: old.chord, staff: old.staff, voice: old.voice,
  });
  const notes = measure.notes.map((n, i) => (i === noteIdx ? rebuilt : n));
  const measures = part0.measures.map((m, i) => (i === measureIdx ? { ...m, notes } : m));
  const parts = state.score.parts.map((p, i) => (i === 0 ? { ...p, measures } : p));
  return { ...state, score: { ...state.score, parts }, dirty: true, revision: state.revision + 1 };
}

/** Grow a part's measures array so index `idx` exists (fresh empty measures). */
function ensureMeasure(part, idx) {
  while (part.measures.length <= idx) {
    part.measures.push({ number: part.measures.length + 1, notes: [] });
  }
}

/**
 * Insert a note at the caret. If it fits the caret's measure, append and advance
 * the caret (rolling to a fresh next measure when the bar becomes exactly full).
 * If it overflows the barline, split it into a tied chain: the head fills the
 * remaining room, the spill starts the next measure. Tie types across a chain of
 * pieces p0..pk are: p0='start', interior='both', pk='stop'. Immutable.
 */
export function insertNote(state, pitch, opts = {}) {
  const total = noteDivisions(makeNote(pitch, opts));
  const capacity = barCapacity(state.score.timeSig);
  const staffVoice = { staff: opts.staff ?? 1, voice: opts.voice ?? 1 };

  const score = cloneScore(state.score);
  const part0 = score.parts[0];

  // Normalize the caret off any already-full measure before inserting.
  let mIdx = state.caret.measureIdx;
  ensureMeasure(part0, mIdx);
  while (capacity - measureFill(part0.measures[mIdx]) <= 0) {
    mIdx += 1;
    ensureMeasure(part0, mIdx);
  }

  const measure = part0.measures[mIdx];
  const room = capacity - measureFill(measure);

  // --- fits fully in the current measure ---
  if (total <= room) {
    measure.notes.push(makeNote(pitch, opts));
    let caret;
    if (total === room) {
      // Bar is now exactly full: park the caret at the start of a fresh measure.
      ensureMeasure(part0, mIdx + 1);
      caret = { measureIdx: mIdx + 1, noteIdx: 0 };
    } else {
      caret = { measureIdx: mIdx, noteIdx: measure.notes.length };
    }
    return { ...state, score, caret, dirty: true, revision: state.revision + 1 };
  }

  // --- overflow: split across the barline into a tied chain ---
  const headPieces = decomposeDuration(room);
  const spillPieces = decomposeDuration(total - room);
  const chain = [...headPieces, ...spillPieces];
  const tied = chain.map((piece, i) => {
    const tie = i === 0 ? 'start' : i === chain.length - 1 ? 'stop' : 'both';
    return makeNote(pitch, { type: piece.type, dots: 0, triplet: false, tie, ...staffVoice });
  });
  const headTied = tied.slice(0, headPieces.length);
  const spillTied = tied.slice(headPieces.length);

  measure.notes.push(...headTied);
  ensureMeasure(part0, mIdx + 1);
  const nextMeasure = part0.measures[mIdx + 1];
  // Spill goes at the FRONT of the next measure (in order).
  nextMeasure.notes.splice(0, 0, ...spillTied);

  return {
    ...state,
    score,
    caret: { measureIdx: mIdx + 1, noteIdx: spillTied.length },
    dirty: true,
    revision: state.revision + 1,
  };
}
