// chordStaff — engrave the live "current chord" as a grand staff via VexFlow
// (SVG backend).
//
// CONTRACT: the staff is FIXED — etched into its box. Its position and its size
// depend only on the host box and the key signature, never on the notes, so it does
// not move, grow, or shrink as you play. That is bought by reserving the worst-case
// vertical headroom in a constant viewBox frame (see FRAME_TOP/FRAME_BOTTOM), which
// costs some engraving size on ordinary chords but never clips an extreme one.
//
// The stave takes a NATURAL width that tracks the box aspect but is CAPPED (see
// MAX_STAVE_ASPECT) so it never stretches edge-to-edge across a wide pane. When the
// cap bites, the viewBox is narrower than the pane, and the SVG's
// preserveAspectRatio="xMidYMid meet" centers the whole compact staff with air on
// both sides — centering is done by the viewBox under `meet`, NOT by shifting the
// note. Clef → key signature → chord flow from the left, as in normal notation.
//
// Spelling is key-signature aware: each MIDI note is given its true letter+alter,
// then VexFlow's Accidental.applyAccidentals draws only the accidentals the key
// signature doesn't already imply (in-key notes are clean; out-of-key get a
// sharp/flat/natural). This is why we can't reuse midiToAbc, which omits the
// accidental for in-key notes and leans on the ABC `K:` header instead.
import { Renderer, Stave, StaveNote, GhostNote, Voice, Formatter, StaveConnector, Accidental, Annotation } from 'vexflow';
import { KEY_SIGNATURES } from '../model/keySignature.js';
import { splitByHand, getOttavaInfo } from '../model/handSplit.js';
import { COLUMN_CAPACITY } from '../model/noteFlow.js';
import { spellPitchClass } from '../model/spelling.js';

// Every column is engraved with the same notehead. The flow shows ORDER, never
// duration — nothing here has measured how long a key was held, so nothing here
// should imply it. A quarter note is the most neutral-looking option that still
// carries a stem for readability.
const NOTE_DURATION = 'q';

const PAD = 8;          // stave's x offset inside the drawing canvas
const TOP_ROOM = 58;    // y of the treble stave's top line (the drawing anchor)
const STAFF_GAP = 66;   // treble top line → bass top line (one grand-staff system)
const BASS_STAFF_H = 40;
const INK = '#1a1a1a';
// Note area the content floor reserves in a narrow slot. Sized from the ink sweep, not
// guessed: at 40 a 12-note cluster's accidental columns overran the frame's right edge
// by up to 40 units in a tall/narrow box, and the fixed frame turns an overrun into a
// clip. See tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs.
const MIN_NOTE_AREA = 88;

// ─── The fixed frame ────────────────────────────────────────────────────────────
// The viewBox is a CONSTANT frame that never depends on what is being played, so
// the staff is etched in place: same position, same size, whatever the chord.
//
// An earlier version fitted the viewBox to the measured ink (`svg.getBBox()`),
// which made the engraving breathe — a low note or an 8vb marker grew the box, and
// `meet` re-centered AND re-scaled everything. Measured in Chrome at 560×210: the
// treble staff shrank 147.5px → 107.7px (−27%) and drifted 60px right / 32px down
// between a middle-C triad and a 36+96 two-hander. Fixing the frame trades some
// engraving size (the worst case is always reserved) for a staff that never moves.
//
// FRAME_TOP/FRAME_BOTTOM come from measuring the drawn ink in Chrome, and the thing
// that measures it is committed:
//
//     node tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs
//
// It renders ~38k cases (every MIDI 21–108 alone, triads, clusters, dense and wide
// two-hand voicings, single columns and full flows, × 13 key signatures × 6 box
// aspects), reports the ink extremes, and exits non-zero if anything lands outside
// the frame. Re-run it after touching these constants, the stave geometry, the
// ottava thresholds, the note duration, or the VexFlow version. Current extremes:
// ink y ∈ [30.5, 249.2], ink x ≥ −6 (the brace overhangs the stave's left edge).
//
// The vertical bounds are aspect- and key-independent, because ottava shifting caps
// the displayed range at A6 on top and E2 at the bottom — so only those notes' ledger
// lines and the 8va/8vb markers reach the extremes. Horizontal is different and is
// handled by MIN_COLUMN_W below, not here.
const FRAME_TOP = 20;        // worst ink top 31 → 11 units of air
const FRAME_BOTTOM = 258;    // worst ink bottom 249.7 → 8 units of air
const FRAME_LEFT = -14;      // worst ink left −6 (brace) → 8 units of air
const FRAME_RIGHT_PAD = 16;  // air to the right of the stave's right edge
const FRAME_H = FRAME_BOTTOM - FRAME_TOP;
// Total horizontal padding the frame adds around the stave itself.
const FRAME_PAD_X = PAD + FRAME_RIGHT_PAD - FRAME_LEFT;

// Cap the frame's aspect (w/h) so an extremely wide pane doesn't stretch the staff
// edge-to-edge; past the cap the frame is narrower than the pane and `meet` centers
// it. 3:1 rather than the 1.7:1 that suited a single parked chord — the flow needs
// real width to lay COLUMN_CAPACITY columns out without cramping them, and the
// Studio row pane (~2.8:1) should fill rather than sit in the left two-thirds.
const MAX_STAVE_ASPECT = 3;
// A one-chord display has nothing to spread, so it keeps the older, more compact cap.
const SINGLE_CHORD_MAX_ASPECT = 1.7;
// Width one column of the flow needs before it starts colliding with its neighbour.
// Sized from the ink sweep against ordinary playing (chords up to five or six notes);
// see tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs.
const MIN_COLUMN_W = 70;

// The content floor reserves room for the WIDEST key signature (7 accidentals), not
// the current one. The displayed key is detected from what is being played and moves
// under your hands (see useDetectedKey), so sizing the floor to the live accidental
// count would let a modulation shove the staff sideways — the exact thing the fixed
// frame exists to prevent. Costs a few units of width in narrow slots; buys a frame
// that is identical in C and in F#.
const MAX_KEY_ACCIDENTALS = 7;

/**
 * Frame/stave geometry for a host box aspect (w/h). The aspect is the ONLY input —
 * not the chord, not the key — which is what keeps the staff fixed while notes come
 * and go, and the box aspect only changes when the container itself is resized.
 *
 * The frame's height is constant (FRAME_H); its width tracks the box aspect so the
 * engraving fills the pane, floored at the content minimum (a narrow slot still
 * fits clef + key signature + a note) and capped at `maxAspect` so a wide pane
 * doesn't stretch the staff edge-to-edge — past the cap the frame is narrower than
 * the pane and `meet` centers it with air on both sides. The cap is a parameter
 * because a one-chord display (a flashcard) wants a compact staff, while the flow
 * wants room for COLUMN_CAPACITY columns.
 */
export function computeChordStaffLayout(aspect, maxAspect = MAX_STAVE_ASPECT) {
  const minStaveW = 44 + MAX_KEY_ACCIDENTALS * 10 + MIN_NOTE_AREA;
  const maxStaveW = Math.round(FRAME_H * maxAspect) - FRAME_PAD_X;
  const valid = Number.isFinite(aspect) && aspect > 0;
  const staveW = valid
    ? Math.max(minStaveW, Math.min(Math.round(FRAME_H * aspect) - FRAME_PAD_X, maxStaveW))
    : minStaveW;
  return {
    staveW,
    viewX: FRAME_LEFT,
    viewY: FRAME_TOP,
    viewW: staveW + FRAME_PAD_X,
    viewH: FRAME_H,
  };
}

/**
 * MIDI → VexFlow key string (e.g. `f#/3`, `bb/4`, `c/4`).
 *
 * Spelling goes through the shared speller (model/spelling.js), the same one the
 * chord-name plaque uses, so the two can never disagree — a B♭ triad draws B♭ D F on
 * the staff AND reads "B♭ major" on the plaque. The accidental glyph here carries the
 * note's TRUE alteration; whether it PRINTS is decided later (see chordNote).
 *
 * The octave comes from the pitch, not the letter, so it is corrected when the
 * spelling crosses an octave boundary: pitch class 11 spelled C♭ belongs to the octave
 * ABOVE its B, and pitch class 0 spelled B♯ to the octave below. Reachable: G♭ major
 * spells pitch class 11 as C♭, F♯ major spells 0 as B♯.
 */
export function midiToVexKey(midi, keySig = 'C', spelling = null) {
  const pc = (((midi % 12) + 12) % 12);
  // A chord spelling, when the caller has one, outranks the per-note tiers: it is the
  // only thing that can keep a chord's letters alternating (G♯–B–D♯, not A♭–B–E♭).
  const { letter, alter } = spelling?.get(pc) ?? spellPitchClass(pc, { keySignature: keySig });
  let octave = Math.floor(midi / 12) - 1;
  if (letter === 'C' && alter === -1) octave += 1; // C♭ sits with the B below it
  if (letter === 'B' && alter === 1) octave -= 1;  // B♯ sits with the C above it
  const glyph = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  return `${letter.toLowerCase()}${glyph}/${octave}`;
}

// Natural-letter pitch classes, for deciding which accidentals the key already implies.
const LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * The alteration a key signature already applies to a letter (+1 sharp, −1 flat, 0).
 * KEY_SIGNATURES stores altered PITCH CLASSES, so a letter is sharped by the key
 * when its natural pc + 1 is in `sharps`, and flatted when pc − 1 is in `flats`.
 */
function keyAlterFor(letter, keySig) {
  const ks = KEY_SIGNATURES[keySig] || KEY_SIGNATURES.C;
  const pc = LETTER_PC[letter];
  if (ks.sharps.includes((pc + 1) % 12)) return 1;
  if (ks.flats.includes((pc + 11) % 12)) return -1;
  return 0;
}

/**
 * Build one column's chord for one staff, with its accidentals resolved against the
 * key signature ONLY — deliberately not against the notes to its left.
 *
 * VexFlow's Accidental.applyAccidentals implements measure semantics: an accidental
 * carries to later notes of the same letter, so a repeated F♯ prints its sharp once
 * and then goes bare. Correct for engraving a score; wrong for a live mirror of the
 * keyboard, where the second F♯ would read as a different note than the first. Each
 * column here is self-contained: if the key doesn't imply the alteration, it shows.
 */
function chordNote(midis, clef, keySig, spelling) {
  if (!midis.length) return null;
  // auto_stem: high chords stem DOWN and low chords stem UP (stems point toward the
  // staff), so the stem doesn't add to a tall chord's overhang and the noteheads
  // stay within the frame's headroom instead of clipping.
  const keys = midis.map((m) => midiToVexKey(m, keySig, spelling));
  const note = new StaveNote({ keys, duration: NOTE_DURATION, clef, auto_stem: true });
  keys.forEach((key, i) => {
    const [written] = key.split('/');
    const letter = written[0];
    // Read the accidental POSITIONALLY, not with includes(): the letter b is itself
    // a 'b', so `written.includes('b')` calls every B natural a B flat.
    const alter = written[1] === '#' ? 1 : written[1] === 'b' ? -1 : 0;
    if (alter === keyAlterFor(letter, keySig)) return;
    const glyph = alter === 1 ? '#' : alter === -1 ? 'b' : 'n';
    note.addModifier(new Accidental(glyph), i);
  });
  return note;
}

/**
 * One column of the flow → a tickable for each staff, ottava-shifted so extreme
 * notes stay near their staff instead of sprouting a tower of ledger lines.
 * Ottava is decided PER COLUMN, so one low bass note gets its own 8vb without
 * dragging the rest of the phrase down an octave with it.
 */
function columnNotes(midis, keySig, spelling) {
  const { bassNotes, trebleNotes } = splitByHand(midis);
  const trebleOtt = getOttavaInfo(trebleNotes, true);
  const bassOtt = getOttavaInfo(bassNotes, false);
  const dispTreble = trebleOtt.octaves ? trebleNotes.map((n) => n - trebleOtt.octaves * 12) : trebleNotes;
  const dispBass = bassOtt.octaves ? bassNotes.map((n) => n + bassOtt.octaves * 12) : bassNotes;

  const tNote = chordNote(dispTreble, 'treble', keySig, spelling);
  const bNote = chordNote(dispBass, 'bass', keySig, spelling);
  // Best-effort 8va/8vb markers (don't fail the render if the Annotation enum shape
  // ever shifts between VexFlow versions).
  try {
    if (trebleOtt.marker && tNote) tNote.addModifier(new Annotation(trebleOtt.marker).setVerticalJustification(Annotation.VerticalJustify.TOP));
    if (bassOtt.marker && bNote) bNote.addModifier(new Annotation(bassOtt.marker).setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
  } catch { /* marker is decorative */ }

  return { tNote, bNote };
}

/**
 * Render the live flow onto `host` as a grand staff.
 *
 * Accepts either shape:
 *   - `columns`: the flow, oldest → newest (see model/noteFlow.js). Each column is
 *     either an array of MIDI notes struck together, or `{ midis, spelling }` where
 *     `spelling` is a pitch-class → { letter, alter } map for that chord; columns
 *     march left to right.
 *   - `notes`: a single Map of live notes — the older single-chord form, kept so
 *     callers that only ever show "what is down right now" still work. It renders
 *     as a one-column flow.
 *
 * @param {HTMLElement} host
 * @param {{ columns?: Array<number[]|{midis: number[], spelling?: Map}>, notes?: Map<number, any>, keySignature?: string, aspect?: number }} opts
 */
export function renderChordStaff(host, { columns, notes, keySignature = 'C', aspect, capacity } = {}) {
  if (!host) return;
  host.innerHTML = '';

  // A column is either a bare list of MIDI notes or { midis, spelling } — the latter
  // carrying how that chord should be WRITTEN (see model/spelling.js spellChord), so
  // its letters alternate and match the name shown beside the staff.
  const allColumns = (columns ?? (notes && notes.size ? [[...notes.keys()]] : []))
    .map((col) => (Array.isArray(col) ? { midis: col, spelling: null } : col))
    .filter((col) => col?.midis?.length)
    .map((col) => ({ midis: [...col.midis].sort((a, b) => a - b), spelling: col.spelling ?? null }));

  const ks = KEY_SIGNATURES[keySignature] ? keySignature : 'C';

  // Frame geometry: a function of the host box aspect ONLY — never of the chord or
  // the key — so the staff stays put as notes come and go and the key drifts.
  const isFlow = !!columns;
  const { staveW, viewX, viewY, viewW, viewH } = computeChordStaffLayout(
    aspect,
    isFlow ? MAX_STAVE_ASPECT : SINGLE_CHORD_MAX_ASPECT,
  );

  // Render at LOGICAL units (no container-width math, no scale cap). The SVG is
  // given a viewBox so the browser scales the whole engraving to fit its box and
  // centers it (preserveAspectRatio) — resolution/DPR independent, never clipped.
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(viewX + viewW, viewY + viewH);
  const ctx = renderer.getContext();
  ctx.setFillStyle(INK);
  ctx.setStrokeStyle(INK);

  const treble = new Stave(PAD, TOP_ROOM, staveW);
  const bass = new Stave(PAD, TOP_ROOM + STAFF_GAP, staveW);
  treble.addClef('treble').addKeySignature(ks);
  bass.addClef('bass').addKeySignature(ks);
  treble.setContext(ctx).draw();
  bass.setContext(ctx).draw();

  new StaveConnector(treble, bass).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
  new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
  new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();

  // Content flows from the LEFT (clef → key signature → notes), and each new column
  // lands to the right of the last, the way typed characters march across a screen.
  //
  // Both staves are laid out by ONE formatter over ALL the slots — the full capacity,
  // even when only two columns are sounding. That is what makes the
  // flow behave like a typewriter instead of a rubber band: slot 1 sits at the same x
  // whether it is alone or the first of eight. Formatting to the live column count
  // would re-space every existing note each time a new one arrived.
  //
  // Empty slots (and the staff that a column doesn't touch — a right-hand-only chord
  // leaves the bass silent) are GhostNotes: they occupy their slot in the voice so the
  // two staves stay column-aligned, but draw nothing. No rests, because a rest is a
  // rhythmic claim and this display makes none.
  const noteAreaW = Math.max(20, staveW - (treble.getNoteStartX() - treble.getX()) - 14);
  const NOTE_INSET = 10; // logical units of air after the key signature

  // How many columns this staff can hold. NOT a constant: the frame is fixed, so a
  // column that doesn't fit isn't squeezed, it's clipped — and eight chords genuinely
  // do not fit a narrow sidebar staff. A narrow pane therefore shows FEWER, readable
  // columns rather than eight cramped ones running off the right edge. The flow model
  // still keeps COLUMN_CAPACITY; this only decides how many of them are drawn.
  // (A single-chord consumer — the flashcard face — gets exactly one.)
  // Measured from the RESERVED head width (clef + the widest key signature), not the
  // actual one. The displayed key moves under your hands, and a real measurement would
  // make G major fit one more column than F♯ — so the flow would gain and lose a column
  // as the key drifted. Same reasoning as the stave-width floor above.
  const slotAreaW = staveW - (44 + MAX_KEY_ACCIDENTALS * 10) - 14;
  const slots = capacity ?? (isFlow
    ? Math.max(1, Math.min(COLUMN_CAPACITY, Math.floor(slotAreaW / MIN_COLUMN_W)))
    : 1);
  const flow = allColumns.slice(-slots);

  const slotNotes = Array.from({ length: slots }, (_, i) =>
    i < flow.length ? columnNotes(flow[i].midis, ks, flow[i].spelling) : { tNote: null, bNote: null }
  );
  const ghost = () => new GhostNote({ duration: NOTE_DURATION });
  const trebleTickables = slotNotes.map((s) => s.tNote ?? ghost());
  const bassTickables = slotNotes.map((s) => s.bNote ?? ghost());

  const makeVoice = (tickables) =>
    new Voice({ num_beats: slots, beat_value: 4 }).setStrict(false).addTickables(tickables);
  const tVoice = makeVoice(trebleTickables);
  const bVoice = makeVoice(bassTickables);

  // joinVoices puts both staves on shared tick contexts, so a column's treble and
  // bass noteheads share one x — the vertical alignment a grand staff needs.
  new Formatter().joinVoices([tVoice]).joinVoices([bVoice]).format([tVoice, bVoice], noteAreaW);
  [...trebleTickables, ...bassTickables].forEach((t) => t.setXShift(NOTE_INSET));
  tVoice.draw(ctx, treble);
  bVoice.draw(ctx, bass);

  // Make the SVG fluid: a viewBox lets the browser scale the engraving to fit its
  // container and center it (xMidYMid meet), preserving aspect ratio. Replaces the
  // fixed px width/height VexFlow stamps on — so it never overflows or clips.
  //
  // The viewBox is the FIXED frame (see FRAME_TOP/FRAME_BOTTOM). It is deliberately
  // NOT measured from the drawn ink: a chord-dependent viewBox is exactly what made
  // the staff shift and resize as you played. Because the frame always reserves the
  // worst-case headroom, a quiet middle-C triad engraves at the same size and in the
  // same place as a 36+96 two-hander with both ottava markers.
  const svg = host.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    // Inline style wins over the attribute, so set it too (VexFlow may stamp a px
    // width/height in style on some paths).
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.maxWidth = '100%';
    svg.style.maxHeight = '100%';
  }
}

export default renderChordStaff;
