// editor.js — EditorState + pure editing commands.
//
// EditorState wraps a Score document (Units 2-5) with interactive editing state.
// Every command is a PURE function returning a NEW state; it never mutates the
// input state or its score. Immutability is achieved by deep-copying only the
// path down to the mutation (spreads) or by cloning the whole score for
// larger structural edits.
import { makeNote, makeRest, noteDivisions } from './note.js';
import { DIVISIONS, decomposeDuration } from '#frontend/modules/MusicNotation/duration.js';
import { pitchToMidi } from '#frontend/modules/MusicNotation/parseMusicXml.js';
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
  if (s.timeSig === undefined) s.timeSig = { beats: 4, beatType: 4 }; // barCapacity depends on this
  if (s.clef === undefined) {
    s.clef = s.parts?.[0]?.clefs?.[1] ?? { sign: 'G', line: 2 };
  }
  // The parsed part.clefs map (e.g. {1:{G,2}, 2:{F,4}} for a grand staff) is the
  // authoritative per-staff clef representation the serializer emits — PRESERVE it
  // as-is. Only backfill staff-1 from the clef mirror when the part carries none
  // (legacy/empty scores), so the serializer always has a clefs map to read.
  const p0 = s.parts?.[0];
  if (p0 && (!p0.clefs || Object.keys(p0.clefs).length === 0)) {
    p0.clefs = { 1: { ...s.clef } };
  }
  return {
    score: s,
    caret: { measureIdx: 0, noteIdx: 0 },
    selection: null,
    armed: false,
    stickyDuration: { type: 'quarter', dots: 0, triplet: false },
    dirty: false,
    revision: 0,
    // Undo/redo snapshot ring (Unit 8, B24). Additive to the Unit 7 shape.
    history: { past: [], future: [] },
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
  // Spread ALL of the old note's fields as opts so nothing (lyric/dynamics/
  // articulations/…) is silently dropped; makeNote overrides pitch/midi/rest
  // from the new pitch argument. (Unit 9 data-loss gate.)
  const rebuilt = makeNote(pitch, { ...old });
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

// ---------------------------------------------------------------------------
// Shared multi-bar splitter (DRY core reused by insertNote / insertRest /
// reflowMeasure / the time re-bar). Given a single element's total duration and
// the room left in its starting bar, decide how to lay it out:
//   - whole:  a single element kept in the starting bar (offset 0), OR
//   - split:  a chain of palette pieces across bars (offset 0 = start bar,
//             offset k = the k-th bar after it).
//
// Non-multiple-of-6 rule (triplet / dotted-16th edge, flagged by the Unit 7
// review): decomposeDuration only accepts multiples of the 16th grid (6). A
// triplet (8 / 16 divs) or a dotted-16th makes a bar's fill — and hence the
// remaining room — a non-multiple of 6, which would throw. v1 pragmatic rule:
// only auto-split when EVERY per-bar chunk is a clean multiple of 6 (and the
// total itself is), otherwise place the element WHOLE in its starting bar (the
// bar may go slightly over; a future focus editor cleans it up). Because a
// whole placement never calls decomposeDuration, triplets never throw.
// ---------------------------------------------------------------------------

/** Break `total` divisions into per-bar chunks: [{offset, divs}, …]. */
function chunkAcrossBars(total, roomInStart, capacity) {
  const chunks = [];
  let remaining = total;
  let room = roomInStart;
  let offset = 0;
  while (remaining > 0) {
    const chunk = Math.min(remaining, room);
    if (chunk > 0) chunks.push({ offset, divs: chunk });
    remaining -= chunk;
    offset += 1;
    room = capacity; // every later bar starts empty
  }
  return chunks;
}

/**
 * Produce placement objects [{offset, note}] for one element.
 * @param {{isRest:boolean, pitch:object|null, baseOpts:object}} el
 * @param {number} total  element duration in divisions
 * @param {number} roomInStart  divisions free in the starting bar
 * @param {number} capacity  bar capacity in divisions
 */
function splitElement({ isRest, pitch, baseOpts }, total, roomInStart, capacity) {
  const chunks = chunkAcrossBars(total, roomInStart, capacity);
  const clean = (v) => Number.isInteger(v) && v % 6 === 0;
  const splittable = chunks.length > 1 && total % 6 === 0 && chunks.every((c) => clean(c.divs));

  if (!splittable) {
    // Keep the element whole in its starting bar (preserves type/dots/triplet
    // and any rich fields via baseOpts). Never calls decomposeDuration.
    const note = isRest ? makeRest(baseOpts) : makeNote(pitch, baseOpts);
    return [{ offset: 0, note }];
  }

  const pieces = []; // {offset, type}
  for (const c of chunks) {
    for (const p of decomposeDuration(c.divs)) pieces.push({ offset: c.offset, type: p.type });
  }
  const n = pieces.length;
  const sv = { staff: baseOpts.staff ?? 1, voice: baseOpts.voice ?? 1 };
  return pieces.map((pc, i) => {
    if (isRest) {
      // Rests DON'T tie: each bar's chunk becomes independent rests.
      return { offset: pc.offset, note: makeRest({ type: pc.type, dots: 0, triplet: false, ...sv }) };
    }
    // TODO: if the note being split already had tie:'start' (incoming tie), the
    // first piece should be 'both'. Edge-only until real tie-pairing lands.
    const tie = i === 0 ? 'start' : i === n - 1 ? 'stop' : 'both';
    // Rich annotations (lyric/dynamics/articulations) belong on the note's ONSET,
    // so seed them onto the FIRST piece only. Interior/final tied pieces must NOT
    // repeat them (a lyric syllable or a dynamic marking sounds once). Dropping
    // this = data loss across a barline split (Unit 9 data-loss gate).
    const rich = i === 0
      ? { lyric: baseOpts.lyric, dynamics: baseOpts.dynamics, articulations: baseOpts.articulations }
      : {};
    return {
      offset: pc.offset,
      note: makeNote(pitch, { type: pc.type, dots: 0, triplet: false, tie, ...sv, ...rich }),
    };
  });
}

/** Insert a built element (note or rest) at the caret, sharing the splitter. */
function insertElement(state, { isRest, pitch, opts }) {
  const probe = isRest ? makeRest(opts) : makeNote(pitch, opts);
  const total = noteDivisions(probe);
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
    measure.notes.push(probe);
    let caret;
    if (total === room) {
      ensureMeasure(part0, mIdx + 1);
      caret = { measureIdx: mIdx + 1, noteIdx: 0 };
    } else {
      caret = { measureIdx: mIdx, noteIdx: measure.notes.length };
    }
    return { ...state, score, caret, dirty: true, revision: state.revision + 1 };
  }

  // --- overflow: distribute via the shared splitter ---
  const placements = splitElement(
    { isRest, pitch, baseOpts: { ...opts, ...staffVoice } },
    total,
    room,
    capacity,
  );
  const byOffset = new Map();
  for (const pl of placements) {
    if (!byOffset.has(pl.offset)) byOffset.set(pl.offset, []);
    byOffset.get(pl.offset).push(pl.note);
  }
  let lastBarIdx = mIdx;
  for (const [off, notes] of byOffset) {
    const idx = mIdx + off;
    ensureMeasure(part0, idx);
    // Starting bar appends after existing content; each later bar receives its
    // pieces at the front (spill-at-front semantics).
    if (off === 0) part0.measures[idx].notes.push(...notes);
    else part0.measures[idx].notes.splice(0, 0, ...notes);
    if (idx > lastBarIdx) lastBarIdx = idx;
  }

  return {
    ...state,
    score,
    caret: { measureIdx: lastBarIdx, noteIdx: part0.measures[lastBarIdx].notes.length },
    dirty: true,
    revision: state.revision + 1,
  };
}

/**
 * Insert a note at the caret. If it fits, append and advance the caret (rolling
 * to a fresh next measure when the bar becomes exactly full). If it overflows,
 * distribute the whole duration across as many bars as needed as ONE tied chain
 * (start → both… → stop). Immutable.
 *
 * v1 limitation: appends at end of the caret's measure; caret.noteIdx not yet
 * honored. Mid-measure insertion is a later unit.
 */
export function insertNote(state, pitch, opts = {}) {
  return insertElement(state, { isRest: false, pitch, opts });
}

/**
 * Insert a rest at the caret. Like insertNote, but rests DON'T tie: an overflow
 * splits into separate rests per bar (no tie chain). Immutable.
 */
export function insertRest(state, opts = {}) {
  return insertElement(state, { isRest: true, pitch: null, opts });
}

// ---------------------------------------------------------------------------
// reflowMeasure — after a command changes a note's duration, a measure may no
// longer fit its bar. Re-split the straddling element across the barline
// (reusing the shared splitter) and cascade spill into fresh measures. Returns
// an ARRAY of measures (the reflowed starting measure, plus any spill measures).
// Underfull measures are left as-is (no back-pull) for v1.
// ---------------------------------------------------------------------------
export function reflowMeasure(measure, timeSig) {
  const capacity = barCapacity(timeSig);
  const notes = measure.notes;

  // Find the first non-chord note that crosses the barline.
  let fill = 0;
  let straddleIdx = -1;
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].chord) continue; // chord notes share their principal's onset
    const d = noteDivisions(notes[i]);
    if (fill + d <= capacity) {
      fill += d;
      continue;
    }
    straddleIdx = i;
    break;
  }
  if (straddleIdx === -1) return [{ ...measure, notes: [...notes] }];

  const head = notes.slice(0, straddleIdx);
  const straddle = notes[straddleIdx];
  // Chord notes attached to the straddling principal travel with it.
  let after = straddleIdx + 1;
  const straddleChords = [];
  while (after < notes.length && notes[after].chord) {
    straddleChords.push(notes[after]);
    after += 1;
  }
  const restAfter = notes.slice(after);

  const room = capacity - fill;
  const d = noteDivisions(straddle);
  const hasChord = straddleChords.length > 0;
  // Splittable only when both head and spill land on the 16th grid, and the
  // straddle carries no chord (splitting a chord across a barline is out of
  // scope for v1 — keep it whole).
  const splittable =
    room >= 6 && room % 6 === 0 && d % 6 === 0 && (d - room) % 6 === 0 && !hasChord;

  let bar0Notes;
  let spillNotes;
  if (room > 0 && splittable) {
    const placements = splitElement(
      { isRest: !!straddle.rest, pitch: straddle.pitch, baseOpts: { ...straddle } },
      d,
      room,
      capacity,
    );
    const headPieces = placements.filter((p) => p.offset === 0).map((p) => p.note);
    const spillPieces = placements.filter((p) => p.offset > 0).map((p) => p.note);
    bar0Notes = [...head, ...headPieces];
    spillNotes = [...spillPieces, ...restAfter];
  } else if (room === 0) {
    // The straddle starts exactly on the barline — move it (and its rest) whole.
    bar0Notes = [...head];
    spillNotes = [straddle, ...straddleChords, ...restAfter];
  } else {
    // Non-grid or chorded: keep the straddle whole in bar0 (bar may go over);
    // push only the following notes to the next bar.
    bar0Notes = [...head, straddle, ...straddleChords];
    spillNotes = [...restAfter];
  }

  const bar0 = { ...measure, notes: bar0Notes };
  if (spillNotes.length === 0) return [bar0];
  const spillMeasure = { number: (measure.number ?? 1) + 1, notes: spillNotes };
  return [bar0, ...reflowMeasure(spillMeasure, timeSig)];
}

/**
 * Apply reflowMeasure to measure `mIdx` of a (mutable, already-cloned) part,
 * cascading any spill into the following measure(s) — merging with existing
 * content there — and renumbering. Used by the duration-changing commands.
 */
function reflowAt(part0, mIdx, timeSig) {
  const reflowed = reflowMeasure(part0.measures[mIdx], timeSig);
  part0.measures[mIdx] = reflowed[0];
  if (reflowed.length > 1) {
    const spillNotes = reflowed.slice(1).flatMap((m) => m.notes);
    const nextIdx = mIdx + 1;
    ensureMeasure(part0, nextIdx);
    part0.measures[nextIdx] = {
      ...part0.measures[nextIdx],
      notes: [...spillNotes, ...part0.measures[nextIdx].notes],
    };
    reflowAt(part0, nextIdx, timeSig);
  }
  part0.measures.forEach((m, i) => {
    m.number = i + 1;
  });
}

/** Rebuild the note at `pos` with a new duration, preserving pitch/rich fields. */
function rebuildDuration(note, patch) {
  return note.rest
    ? makeRest({ ...note, ...patch })
    : makeNote(note.pitch, { ...note, ...patch });
}

/** Replace one note in measure `mIdx` at `noteIdx` inside a cloned part. */
function replaceNoteInPart(part0, mIdx, noteIdx, newNote) {
  const measure = part0.measures[mIdx];
  measure.notes = measure.notes.map((n, i) => (i === noteIdx ? newNote : n));
}

/**
 * Change the duration of the note at `pos`, then reflow its measure (which may
 * re-split following content across the barline, or — per the triplet rule —
 * keep it whole). Immutable.
 */
export function setDuration(state, { measureIdx, noteIdx }, { type, dots = 0, triplet = false }) {
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const old = part0.measures[measureIdx].notes[noteIdx];
  replaceNoteInPart(part0, measureIdx, noteIdx, rebuildDuration(old, { type, dots, triplet }));
  reflowAt(part0, measureIdx, score.timeSig);
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}

/** Toggle the dot on the note at `pos` (dots 0 ↔ 1), then reflow. Immutable. */
export function toggleDot(state, { measureIdx, noteIdx }) {
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const old = part0.measures[measureIdx].notes[noteIdx];
  replaceNoteInPart(part0, measureIdx, noteIdx, rebuildDuration(old, { dots: old.dots ? 0 : 1 }));
  reflowAt(part0, measureIdx, score.timeSig);
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}

/** Toggle the triplet flag on the note at `pos`, then reflow. Immutable. */
export function toggleTriplet(state, { measureIdx, noteIdx }) {
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const old = part0.measures[measureIdx].notes[noteIdx];
  replaceNoteInPart(part0, measureIdx, noteIdx, rebuildDuration(old, { triplet: !old.triplet }));
  reflowAt(part0, measureIdx, score.timeSig);
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}

/**
 * Toggle the tie on the note at `pos`: null → 'start', anything → null. This is
 * a simple single-note toggle; a full tie pairs 'start'/'stop' with the next
 * note in a later unit. Tie doesn't change duration, so no reflow. Immutable.
 */
export function toggleTie(state, { measureIdx, noteIdx }) {
  // No-op guard: an out-of-range target changes nothing, so return the SAME
  // state reference — history's reference check then skips a bogus undo entry.
  const old = state.score.parts[0]?.measures[measureIdx]?.notes[noteIdx];
  if (!old) return state;
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const target = part0.measures[measureIdx].notes[noteIdx];
  replaceNoteInPart(part0, measureIdx, noteIdx, rebuildDuration(target, { tie: target.tie ? null : 'start' }));
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}

/** Remove the note at `pos`; clamp the caret to a valid position. Immutable. */
export function deleteNote(state, { measureIdx, noteIdx }) {
  // No-op guard: nothing to remove at an out-of-range index → return the SAME
  // state reference so history doesn't record an empty change.
  const measure0 = state.score.parts[0]?.measures[measureIdx];
  if (!measure0 || noteIdx < 0 || noteIdx >= measure0.notes.length) return state;
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const measure = part0.measures[measureIdx];
  measure.notes = measure.notes.filter((_, i) => i !== noteIdx);
  // Clamp the caret: keep an empty measure; land at the new last+1 (== length).
  let caret = state.caret;
  if (caret.measureIdx === measureIdx) {
    caret = { measureIdx, noteIdx: Math.min(caret.noteIdx, measure.notes.length) };
  }
  return { ...state, score, caret, dirty: true, revision: state.revision + 1 };
}

// ---------------------------------------------------------------------------
// Pitch nudging + caret/selection moves (B22)
// ---------------------------------------------------------------------------

/**
 * Spell a MIDI number as {step, octave, alter}. Naturals where possible, sharps
 * for the black keys by default (C, C#, D, D#, …). keyFifths is accepted for a
 * future key-aware spelling; the v1 rule ignores it (always sharps).
 */
export function midiToPitch(midi, keyFifths = 0) {
  void keyFifths;
  const SPELL = [
    { step: 'C', alter: 0 }, { step: 'C', alter: 1 }, { step: 'D', alter: 0 },
    { step: 'D', alter: 1 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 },
    { step: 'F', alter: 1 }, { step: 'G', alter: 0 }, { step: 'G', alter: 1 },
    { step: 'A', alter: 0 }, { step: 'A', alter: 1 }, { step: 'B', alter: 0 },
  ];
  const semitone = ((midi % 12) + 12) % 12;
  const s = SPELL[semitone];
  return { step: s.step, octave: Math.floor(midi / 12) - 1, alter: s.alter };
}

/**
 * Raise/lower the SELECTED note by `delta` chromatic semitones. No-op (returns
 * the same state) when there's no selection or the selection is a rest.
 * Immutable.
 */
export function nudgePitch(state, delta) {
  const sel = state.selection;
  if (!sel) return state;
  const score = cloneScore(state.score);
  const part0 = score.parts[0];
  const old = part0.measures[sel.measureIdx]?.notes[sel.noteIdx];
  if (!old || old.rest) return state;
  const pitch = midiToPitch(old.midi + delta, score.key?.fifths ?? 0);
  replaceNoteInPart(part0, sel.measureIdx, sel.noteIdx, makeNote(pitch, { ...old }));
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}

/**
 * Move the caret. `where` ∈ left | right | barStart | barEnd | prevBar | nextBar.
 * Clamped to valid bounds. Does NOT change the score (no history push).
 */
export function moveCaret(state, where) {
  const measures = state.score.parts[0].measures;
  const count = (idx) => measures[idx]?.notes.length ?? 0;
  let { measureIdx, noteIdx } = state.caret;
  switch (where) {
    case 'left':
      if (noteIdx > 0) noteIdx -= 1;
      else if (measureIdx > 0) {
        measureIdx -= 1;
        noteIdx = count(measureIdx);
      }
      break;
    case 'right':
      if (noteIdx < count(measureIdx)) noteIdx += 1;
      else if (measureIdx < measures.length - 1) {
        measureIdx += 1;
        noteIdx = 0;
      }
      break;
    case 'barStart':
      noteIdx = 0;
      break;
    case 'barEnd':
      noteIdx = count(measureIdx);
      break;
    case 'prevBar':
      if (measureIdx > 0) {
        measureIdx -= 1;
        noteIdx = Math.min(noteIdx, count(measureIdx));
      }
      break;
    case 'nextBar':
      if (measureIdx < measures.length - 1) {
        measureIdx += 1;
        noteIdx = Math.min(noteIdx, count(measureIdx));
      }
      break;
    default:
      break;
  }
  return { ...state, caret: { measureIdx, noteIdx } };
}

/** Set (or clear) the selection. Does NOT change the score. */
export function select(state, pos) {
  return { ...state, selection: pos ? { ...pos } : null };
}

// ---------------------------------------------------------------------------
// setAttribute — score-level attributes (B23)
// ---------------------------------------------------------------------------

/**
 * Re-bar an entire part into freshly-sized measures for `timeSig`. Flattens all
 * notes to a single sequence and re-packs them via the shared splitter, so a
 * 4/4 part set to 3/4 re-bars while preserving total duration. Mutates the
 * (already-cloned) part.
 */
function rebarPart(part0, timeSig) {
  const capacity = barCapacity(timeSig);
  const flat = part0.measures.flatMap((m) => m.notes);
  const measures = [{ number: 1, notes: [] }];
  let barIdx = 0;
  const ensure = (idx) => {
    while (measures.length <= idx) measures.push({ number: measures.length + 1, notes: [] });
  };

  for (const el of flat) {
    if (el.chord) {
      measures[barIdx].notes.push(el); // rides with its principal, no fill
      continue;
    }
    // Advance off any full (or over-full) bar.
    while (measureFill(measures[barIdx]) >= capacity) {
      barIdx += 1;
      ensure(barIdx);
    }
    const room = capacity - measureFill(measures[barIdx]);
    const d = noteDivisions(el);
    if (d <= room) {
      measures[barIdx].notes.push(el);
      continue;
    }
    const placements = splitElement(
      { isRest: !!el.rest, pitch: el.pitch, baseOpts: { ...el } },
      d,
      room,
      capacity,
    );
    let maxOffset = 0;
    for (const pl of placements) {
      const idx = barIdx + pl.offset;
      ensure(idx);
      measures[idx].notes.push(pl.note);
      if (pl.offset > maxOffset) maxOffset = pl.offset;
    }
    barIdx += maxOffset; // next iteration's room check advances off a full bar
  }

  // Drop a trailing empty bar, keep at least one, renumber.
  while (measures.length > 1 && measures[measures.length - 1].notes.length === 0) measures.pop();
  measures.forEach((m, i) => {
    m.number = i + 1;
  });
  part0.measures = measures;
}

/**
 * Set a score-level attribute immutably.
 *   'tempo' → score.tempo = value
 *   'key'   → score.key merged with value ({fifths, mode})
 *   'clef'  → score.clef = value
 *   'time'  → score.timeSig = value AND re-bar the whole part to the new capacity
 */
export function setAttribute(state, name, value) {
  const score = cloneScore(state.score);
  switch (name) {
    case 'tempo':
      score.tempo = value;
      break;
    case 'key':
      score.key = { ...score.key, ...value };
      break;
    case 'clef':
      // v1 is single-staff: staff 1 is the target. Update the authoritative
      // part.clefs[1] AND the score.clef mirror.
      score.clef = value;
      if (score.parts?.[0]) {
        score.parts[0].clefs = { ...score.parts[0].clefs, 1: value };
      }
      break;
    case 'time':
      score.timeSig = value;
      rebarPart(score.parts[0], value);
      break;
    default:
      break;
  }
  return { ...state, score, dirty: true, revision: state.revision + 1 };
}
