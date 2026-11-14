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
import { Renderer, Stave, StaveNote, GhostNote, Voice, Formatter, StaveConnector, Accidental, Annotation, Beam, Stroke, TextFormatter } from 'vexflow';
import { KEY_SIGNATURES } from "../model/keySignature.js";
import { splitByHand, getOttavaInfo } from "../model/handSplit.js";
import { columnRolls } from "../model/noteFlow.js";
import { spellPitchClass } from "../model/spelling.js";

// A column with no duration of its own — every column of a single-chord display, and
// the newest column of a flow before its gap is known — draws as a quarter. It is the
// most neutral of the three glyphs and still carries a stem for readability.
//
// The three durations the flow can ask for ('8', 'q', 'h') are RELATIVE, decided in
// model/noteFlow.js against a moving baseline. Nothing here means a metrical eighth:
// there is still no meter, no barline, and no tempo on this staff.
const NOTE_DURATION = 'q';

const PAD = 8;          // stave's x offset inside the drawing canvas
const TOP_ROOM = 58;    // y of the treble stave's top line (the drawing anchor)
const STAFF_GAP = 66;   // treble top line → bass top line (one grand-staff system)
const INK = '#1a1a1a';
// Note area the content floor reserves in a narrow slot. Sized from the ink sweep, not
// guessed: at 40 a 12-note cluster's accidental columns overran the frame's right edge
// by up to 40 units in a tall/narrow box, and the fixed frame turns an overrun into a
// clip. See tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs.
const MIN_NOTE_AREA = 88;
// Air between the key signature's last glyph and the first column's leftmost ink
// (an accidental or a roll stroke), in logical units.
const KEY_SIGNATURE_AIR = 4;

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
// It renders ~152k cases (every MIDI 21–108 alone, triads, clusters, dense and wide
// two-hand voicings, single columns and full flows, × 13 key signatures × 6 box
// aspects × 4 duration patterns), reports the ink extremes, and exits non-zero if
// anything lands outside the frame or two neighbouring columns collide. Re-run it after
// touching these constants, the stave geometry, the column layout, the ottava
// thresholds, the durations, or the VexFlow version. Current extremes (2026-11-14):
// ink y ∈ [20.5, 254.2], ink x ≥ −6 (the brace overhangs the stave's left edge). The
// top is an 8va label over a high flow of alternating eighths and halves — inside the
// frame, with half a unit to spare.
//
// The vertical bounds are aspect- and key-independent, because ottava shifting caps
// the displayed range at A6 on top and E2 at the bottom — so only those notes' ledger
// lines and the 8va/8vb markers reach the extremes. Horizontal is different and is
// handled by the column layout below (layoutColumns), not here.
const FRAME_TOP = 20;        // worst ink top 20.5 → 0.5 units of air
const FRAME_BOTTOM = 258;    // worst ink bottom 254.2 → 3.8 units of air
const FRAME_LEFT = -14;      // worst ink left −6 (brace) → 8 units of air
const FRAME_RIGHT_PAD = 16;  // air to the right of the stave's right edge
const FRAME_H = FRAME_BOTTOM - FRAME_TOP;
// Total horizontal padding the frame adds around the stave itself.
const FRAME_PAD_X = PAD + FRAME_RIGHT_PAD - FRAME_LEFT;

// Cap the frame's aspect (w/h) so an extremely wide pane doesn't stretch the staff
// edge-to-edge; past the cap the frame is narrower than the pane and `meet` centers
// it. 3:1 rather than the 1.7:1 that suited a single parked chord — the flow needs
// real width to lay a line of columns out without cramping them, and the
// Studio row pane (~2.8:1) should fill rather than sit in the left two-thirds.
const MAX_STAVE_ASPECT = 3;
// A one-chord display has nothing to spread, so it keeps the older, more compact cap.
const SINGLE_CHORD_MAX_ASPECT = 1.7;
// ─── Column widths ──────────────────────────────────────────────────────────────
// The flow is NOT laid on a uniform grid. Each column takes a width from its duration,
// floored at what its ink needs, so a run of quick notes packs closer and more of a
// fast phrase stays on screen before the oldest scrolls off — while a held note keeps
// some room around it, the way engraved music spaces long notes wider than short ones.
//
// Widths are in units of W_Q, the width a quarter takes. W_Q is a function of the BOX
// only: the room a C-major line has after its clef, over QUARTERS_PER_LINE — the width
// the old fixed grid gave each of its eight slots. Neither the chord nor the key can
// change how wide a quarter is; a key signature only takes room from the line, so seven
// sharps leave space for a column or so fewer.
const QUARTERS_PER_LINE = 8;
// A narrow pane (a sidebar staff) divided by eight would give a quarter ~17 units —
// noteheads shoulder to shoulder. This floor keeps a quarter readable there; the pane
// shows fewer columns instead, as it always has.
const MIN_QUARTER_W = 54;
// Engraving spaces durations roughly by their square root, not their length: a half is
// not twice a quarter on the page. 2/3 : 1 : 4/3 is close to that curve (√½ ≈ 0.71,
// √2 ≈ 1.41) and keeps the eighth wide enough for a flagged stem and the next note's
// accidental: at the Studio pane (W_Q ≈ 71) an eighth is ~47 units, so twelve eighths
// fit where eight quarters do — "a little density" for the fast notes, not a
// squeeze. Unknown durations fall back to a quarter's width.
const DURATION_WIDTH = { 8: 2 / 3, q: 1, h: 4 / 3 };
// Minimum air between one column's rightmost ink and the next column's leftmost (an
// accidental, a roll stroke, a displaced head), in logical units. The content floor:
// when two columns' ink needs more than their durations give them, the duration loses.
// 6, not the 2 the ink sweep demands, because VexFlow's metrics run a little short of
// the drawn outlines: at 4 the sweep measured 1.6 units between neighbours where the
// floor bit (eighth beside half at the narrow 1.36 pane). 6 keeps >= 2 everywhere.
const COLUMN_GAP = 6;
// Where ink must stop short of the stave's right barline.
const END_AIR = 6;
// Logical units of air after the key signature before the first column's tick position.
const NOTE_INSET = 10;

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
 * wants room for a line of columns.
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
  // Same letter-wrap rule as spellMidi.js's octave math — kept local because
  // spellPitchClass is pitch-class-only (no octave to correct at the source).
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
function chordNote(midis, clef, keySig, spelling, duration = NOTE_DURATION, stemDir = null) {
  if (!midis.length) return null;
  // auto_stem: high chords stem DOWN and low chords stem UP (stems point toward the
  // staff), so the stem doesn't add to a tall chord's overhang and the noteheads
  // stay within the frame's headroom instead of clipping.
  const keys = midis.map((m) => midiToVexKey(m, keySig, spelling));
  // `stemDir` forces a direction — only the width measurement asks for one.
  const note = new StaveNote(stemDir ? { keys, duration, clef, stem_direction: stemDir } : { keys, duration, clef, auto_stem: true });
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
function columnNotes(midis, keySig, spelling, duration = NOTE_DURATION, arrivals = [], stemDir = null) {
  const { bassNotes, trebleNotes } = splitByHand(midis);
  const trebleOtt = getOttavaInfo(trebleNotes, true);
  const bassOtt = getOttavaInfo(bassNotes, false);
  const dispTreble = trebleOtt.octaves ? trebleNotes.map((n) => n - trebleOtt.octaves * 12) : trebleNotes;
  const dispBass = bassOtt.octaves ? bassNotes.map((n) => n + bassOtt.octaves * 12) : bassNotes;

  const tNote = chordNote(dispTreble, 'treble', keySig, spelling, duration, stemDir);
  const bNote = chordNote(dispBass, 'bass', keySig, spelling, duration, stemDir);
  // Best-effort 8va/8vb markers (don't fail the render if the Annotation enum shape
  // ever shifts between VexFlow versions).
  try {
    if (trebleOtt.marker && tNote) tNote.addModifier(new Annotation(trebleOtt.marker).setVerticalJustification(Annotation.VerticalJustify.TOP));
    if (bassOtt.marker && bNote) bNote.addModifier(new Annotation(bassOtt.marker).setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
  } catch { /* marker is decorative */ }

  // A rolled chord arrives as ONE column (model/noteFlow.js), so the roll is drawn as
  // the arpeggio stroke engraving uses for it — decided PER STAFF from the arrivals,
  // because each hand rolls on its own: a two-hand roll often runs the right hand top
  // down while the left goes bottom up, or rolls one hand over a struck other. A
  // column-wide verdict drew one direction on both staves and stroked a struck hand.
  // 'up' is the plain wavy line (piano notation: bottom → top); 'down' is VexFlow's
  // ROLL_UP, which — guitar naming — draws the arrowhead pointing DOWN.
  try {
    // columnRolls splits the column by hand exactly as above, so the strokes drawn
    // and the strokes the log/harness report come from one pairing.
    const rolls = columnRolls({ midis, arrivals });
    for (const [n, roll] of [[tNote, rolls.treble], [bNote, rolls.bass]]) {
      if (n && roll) {
        n.addStroke(0, new Stroke(roll === 'down' ? Stroke.Type.ROLL_UP : Stroke.Type.ARPEGGIO_DIRECTIONLESS));
      }
    }
  } catch { /* stroke is decorative */ }

  return { tNote, bNote };
}

// ─── Measuring a column ─────────────────────────────────────────────────────────

// Staves the measuring formatter hangs notes on (Annotation format reads the stave).
// Position and key do not matter: only widths are read.
let measureStaves = null;
const staffFor = (clef) => {
  measureStaves ||= {
    treble: new Stave(0, 0, 500).addClef('treble'),
    bass: new Stave(0, 0, 500).addClef('bass'),
  };
  return measureStaves[clef];
};

// A column's ink depends only on what it holds, so its measurement is cached by that.
// Bounded so a long session does not grow it without limit.
const MEASURE_CACHE_MAX = 4096;
const measureCache = new Map();

/**
 * How far one column's ink reaches either side of its tick position, in logical units:
 * `left` is accidentals + roll stroke + any left-displaced head; `right` is the
 * notehead(s), any right-displaced head, a stem-up flag and right modifiers. From
 * VexFlow's own tick-context metrics after formatting, the same numbers it would draw
 * with.
 *
 * Measured over BOTH stem directions and over every duration given, taking the widest
 * reach each way. Stem direction is not the column's own: a beam group decides it, and
 * which group a column falls in changes as later notes arrive (the newest eighth joins
 * its neighbour's beam, or grows to a quarter and leaves it). A chord with a second
 * puts its displaced head — and shoves its accidentals — on the side the stem dictates,
 * so a width read from the drawn direction would let a beam decision move the columns
 * to its right. The widest reach is the price of never moving them. `autoLeft` is the
 * left reach in the column's own (auto_stem) direction, for the single-chord display.
 */
function measureColumn(col, ks, durations) {
  const rolls = columnRolls(col);
  const spellingKey = col.spelling ? [...col.spelling.entries()].map(([pc, sp]) => `${pc}${sp.letter}${sp.alter}`).join(',') : '';
  const key = `${ks}|${col.midis.join('.')}|${spellingKey}|${rolls.treble ?? ''}/${rolls.bass ?? ''}|${[...durations].sort().join('')}`;
  const hit = measureCache.get(key);
  if (hit) return hit;
  let left = 0;
  let right = 0;
  let autoLeft = 0;
  for (const duration of durations) {
    for (const stemDir of [null, 1, -1]) {
      const { tNote, bNote } = columnNotes(col.midis, ks, col.spelling, duration, col.arrivals, stemDir);
      const notes = [[tNote, 'treble'], [bNote, 'bass']].filter(([n]) => n);
      notes.forEach(([n, clef]) => n.setStave(staffFor(clef)));
      const voices = notes.map(([n]) => new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false).addTickables([n]));
      const formatter = new Formatter();
      voices.forEach((v) => formatter.joinVoices([v]));
      formatter.format(voices, 0);
      const m = notes[0][0].getTickContext().getMetrics();
      // An 8va/8vb label draws from the note's start rightwards, its whole width (measured
      // in Chrome: "15mb" spans head x → head x + 34), while the formatter books it as
      // centred — half of it to the left. Take the drawn reach.
      const label = Math.max(0, ...notes.flatMap(([n]) => n.getModifiers()
        .filter((mod) => mod instanceof Annotation)
        .map((mod) => TextFormatter.create(mod.textFont).getWidthForTextInPx(mod.text))));
      // Two heads on ONE line — a letter spelled both ways in one chord, D with D♯ —
      // draw side by side, but VexFlow's metrics don't count the second head as
      // displaced (it isn't a second), so they report one head's width. The ink sweep
      // caught the hidden head colliding with the next column. Book a second head's
      // width on each side, since which side it takes follows the stem.
      const unison = notes.some(([n]) => n.getKeyProps()
        .some((k, i, all) => all.some((o, j) => j !== i && o.line === k.line)));
      const extra = unison ? m.glyphPx : 0;
      const l = m.totalLeftPx + extra;
      const r = Math.max(m.notePx + m.totalRightPx + extra, label);
      // autoLeft is the plain metric, as the single-chord display has always used it.
      if (stemDir === null) autoLeft = Math.max(autoLeft, m.totalLeftPx);
      left = Math.max(left, l);
      right = Math.max(right, r);
    }
  }
  const out = { left, right, autoLeft };
  if (measureCache.size >= MEASURE_CACHE_MAX) measureCache.clear();
  measureCache.set(key, out);
  return out;
}

// Width of the stave's head with NO key signature (the clef alone), in either clef:
// what the box-only quarter width is measured after (see W_Q above).
let clefHead = null;
function clefHeadW() {
  if (clefHead === null) {
    clefHead = 0;
    for (const clef of ['treble', 'bass']) {
      const st = new Stave(0, 0, 500).addClef(clef);
      clefHead = Math.max(clefHead, st.getNoteStartX() - st.getX());
    }
  }
  return clefHead;
}

// The stave's own padding between its note start and a tick context at x = 0.
let notePadding = null;
function notePaddingOf(stave) {
  if (notePadding === null) {
    const n = new StaveNote({ keys: ['c/4'], duration: 'q', clef: 'treble' });
    const v = new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false).addTickables([n]);
    new Formatter().joinVoices([v]).format([v], 0);
    n.setStave(stave);
    n.getTickContext().setX(0);
    notePadding = n.getAbsoluteX() - stave.getNoteStartX();
  }
  return notePadding;
}

/** W_Q: the width a quarter takes on a stave this wide — a function of the box only. */
export function quarterWidth(staveW) {
  const area = staveW - END_AIR - clefHeadW() - notePaddingOf(staffFor('treble')) - NOTE_INSET;
  return Math.max(MIN_QUARTER_W, area / QUARTERS_PER_LINE);
}

/** Normalize the caller's columns (bare MIDI lists or column objects), dropping empties. */
function normalizeColumns(columns, notes) {
  // A column is either a bare list of MIDI notes or { midis, spelling } — the latter
  // carrying how that chord should be WRITTEN (see model/spelling.js spellChord), so
  // its letters alternate and match the name shown beside the staff.
  return (columns ?? (notes && notes.size ? [[...notes.keys()]] : []))
    .map((col) => (Array.isArray(col) ? { midis: col, spelling: null } : col))
    .filter((col) => col?.midis?.length)
    .map((col) => {
      // '8' | 'q' | 'h', or absent for callers that don't carry rhythm at all.
      const duration = col.duration ?? NOTE_DURATION;
      return {
        midis: [...col.midis].sort((a, b) => a - b),
        spelling: col.spelling ?? null,
        duration,
        // The duration the column's WIDTH is taken from. A closed column's is the one
        // it closed with (model/noteFlow.js closeDuration); a later hold promotion
        // redraws the glyph as a half but must not widen the column and shove every
        // column to its right. The newest column has none yet: its width tracks its
        // provisional glyph — nothing is to its right to move.
        widthDuration: col.widthDuration ?? duration,
        // { midi, at } per note in arrival order — what each staff's roll is read from.
        arrivals: Array.isArray(col.arrivals) ? col.arrivals : [],
      };
    });
}

/**
 * Where each column of a flow goes, and which of them are on screen.
 *
 * Positions are tick-context x (relative to the stave's note start), left to right:
 *
 *     x[first] = NOTE_INSET + lead
 *     x[i + 1] = x[i] + max(width(duration of i), right(i) + COLUMN_GAP + left(i + 1))
 *
 * — each column's head sits its DURATION's width after the last one's, unless the two
 * columns' ink would come closer than COLUMN_GAP, in which case the ink wins. A column's
 * x therefore depends only on the columns to its left (and its own left reach). Closed
 * columns' widths are fixed when they close, so nothing already drawn moves while the
 * newest column grows from an eighth to a quarter to a half: it has nothing to its right.
 *
 * On screen are the NEWEST columns whose widths fit the note area (the newest counting
 * its own duration width, so a held note claims its room): at least one, at most
 * `maxCount`. When the newest outgrows the room, the oldest drops off the left and the
 * line shifts — the same scroll a new column causes.
 *
 * `lead` is how late the first column starts so its left ink (accidentals, a roll
 * stroke) clears the key signature by KEY_SIGNATURE_AIR. It depends only on the
 * leftmost column on screen, which changes only when the line scrolls.
 *
 * @returns {{ start: number, xs: number[], quarterW: number }} `start`: index of the
 *   first column on screen; `xs`: tick x of columns start..end.
 */
function layoutColumns(cols, ks, stave, staveW, maxCount, { reachBothWays = true } = {}) {
  const n = cols.length;
  const quarterW = quarterWidth(staveW);
  if (!n) return { start: 0, xs: [], quarterW };
  const pad = notePaddingOf(stave);
  // Tick x past which no ink may reach: the barline, less END_AIR.
  const limit = stave.getX() + staveW - END_AIR - stave.getNoteStartX() - pad;
  const m = cols.map((c) => measureColumn(c, ks, [...new Set([c.widthDuration, c.duration])]));
  const leftOf = (i) => (reachBothWays ? m[i].left : m[i].autoLeft);
  const durW = (d) => (DURATION_WIDTH[d] ?? 1) * quarterW;
  const step = (i) => Math.max(durW(cols[i].widthDuration), m[i].right + COLUMN_GAP + m[i + 1].left);
  // The head of the stave puts the note start KEY_SIGNATURE_AIR - pad left of x = 0.
  const leadOf = (j) => Math.max(0, KEY_SIGNATURE_AIR + leftOf(j) - pad - NOTE_INSET);
  let start = n - 1;
  let span = Math.max(durW(cols[n - 1].widthDuration), m[n - 1].right + COLUMN_GAP);
  while (start > 0 && n - start < maxCount) {
    const wider = span + step(start - 1);
    if (NOTE_INSET + leadOf(start - 1) + wider > limit) break;
    span = wider;
    start -= 1;
  }
  // A lone column too wide for the pane (a forearm cluster in a narrow box) would be
  // pushed off the right edge by the both-ways reserve. With nothing beside it no beam
  // can flip its stem, so its own direction's reach is the honest lead there.
  let lead = leadOf(start);
  if (start === n - 1 && NOTE_INSET + lead + m[start].right > limit) {
    lead = Math.max(0, KEY_SIGNATURE_AIR + m[start].autoLeft - pad - NOTE_INSET);
  }
  const xs = [];
  let x = NOTE_INSET + lead;
  for (let i = start; i < n; i += 1) {
    xs.push(x);
    if (i < n - 1) x += step(i);
  }
  return { start, xs, quarterW };
}

/**
 * The window a flow staff would draw: how many of the NEWEST columns are on screen, and
 * where. renderChordStaff's own layout, without drawing — exported so the replay
 * harness lists exactly the columns the pane shows.
 *
 * @param {Array} columns - as renderChordStaff takes them
 * @param {{ aspect?: number, keySignature?: string, capacity?: number }} [opts]
 * @returns {{ count: number, xs: number[], quarterW: number }}
 */
export function chordStaffWindow(columns, { aspect, keySignature = 'C', capacity = Infinity } = {}) {
  const ks = KEY_SIGNATURES[keySignature] ? keySignature : 'C';
  const cols = normalizeColumns(columns);
  const { staveW } = computeChordStaffLayout(aspect, MAX_STAVE_ASPECT);
  const stave = new Stave(PAD, TOP_ROOM, staveW).addClef('treble').addKeySignature(ks);
  const { start, xs, quarterW } = layoutColumns(cols, ks, stave, staveW, capacity);
  return { count: cols.length - start, xs, quarterW };
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
 * @param {{ columns?: Array<number[]|{midis: number[], spelling?: Map, duration?: string, arrivals?: Array<{midi: number, at: number}>}>, notes?: Map<number, any>, keySignature?: string, aspect?: number }} opts
 */
export function renderChordStaff(host, { columns, notes, keySignature = 'C', aspect, capacity } = {}) {
  if (!host) return;
  host.innerHTML = '';

  const allColumns = normalizeColumns(columns, notes);

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
  // Where each column goes, and how many fit, is layoutColumns' job (see it for the
  // rule): heads are spaced by duration, floored at what the ink needs, and a column's
  // x depends only on the columns to its left — the typewriter, not a rubber band.
  // A single-chord consumer (the flashcard face) gets exactly one column, with its lead
  // read from its own stem direction since no beam can ever flip it.
  const maxCount = capacity ?? (isFlow ? Infinity : 1);
  const { start, xs } = layoutColumns(allColumns, ks, treble, staveW, maxCount, { reachBothWays: isFlow });
  const flow = allColumns.slice(start);
  const count = flow.length;

  // A column's duration belongs to the COLUMN, not to a staff: treble, bass, and the
  // ghost standing in for whichever staff the column doesn't touch all take the same
  // one. Per-staff durations would give the two voices different tick totals and the
  // staves would drift out of vertical alignment column by column.
  //
  // The staff a column doesn't touch (a right-hand-only chord leaves the bass silent)
  // gets a GhostNote: it holds the column's place in that voice so the two staves stay
  // column-aligned, but draws nothing. No rests, because a rest is a rhythmic claim and
  // this display makes none.
  const durations = flow.map((c) => c.duration);
  const slotNotes = flow.map((c) => columnNotes(c.midis, ks, c.spelling, c.duration, c.arrivals));
  const trebleTickables = slotNotes.map((s, i) => s.tNote ?? new GhostNote({ duration: durations[i] }));
  const bassTickables = slotNotes.map((s, i) => s.bNote ?? new GhostNote({ duration: durations[i] }));

  // Beam groups and their stem directions are decided HERE, before the formatter runs.
  // The formatter's modifier context lays accidentals and roll strokes out around the
  // displaced noteheads of the stem direction the note has AT FORMAT TIME (Accidental
  // and Stroke format both read getLeftDisplacedHeadPx). Flipping a stem afterwards
  // moved a chord-with-a-second's displaced head to the other side and left its flat
  // where the old head had been: E♭4-F4-G4 grouped with high notes flipped down and drew
  // the F on top of the flat. Everything the plan needs — durations, staff lines, the
  // auto_stem direction — is known at construction. The Beam objects themselves are
  // built after positioning (below), so they span the x the notes finally take.
  //
  // A group is two or more consecutive eighth columns on ONE staff; a slower column, or
  // a slot this staff doesn't play, breaks the run.
  // A run does NOT break where the notes' own stems would point different ways: the
  // eighth-biased durations exist so a phrase beams into one line, and breaking on
  // every stem flip left a melody crossing the middle line as a row of lone flags.
  // Instead the whole group takes ONE direction, the engraver's rule: down when its
  // noteheads sit on or above the middle line on average, up when below. That still
  // points stems toward the staff for the group as a whole — the property the fixed
  // frame was measured against (Beam's own majority vote, which ignores where the
  // notes sit, is what once pushed a low bass beam 11 units past the frame). The beam
  // is then built with auto_stem OFF so it keeps the direction chosen here.
  //
  // The average is over the group's FIRST TWO columns only, never the whole run. The
  // run is live: every eighth struck joins it, and the newest column can leave it again
  // by growing to a quarter. A whole-run mean re-voted on each of those, flipping stems
  // that were already drawn and swinging the beam to the other side of the notes under
  // the player's eyes. Two columns are all a beam needs to exist, and once the second
  // has closed nothing appended can reach the vote.
  //
  // One exception, also caught by the ink sweep: a note OUTSIDE the staff whose stem
  // the group would turn away from the staff (a high ledger note stemmed up, a low one
  // stemmed down) throws its stem — and the beam on it — past the fixed frame. Such a
  // note keeps its own direction and flag, and splits the group around it.
  const MIDDLE_LINE = 3;
  const TOP_LINE = 5;
  const BOTTOM_LINE = 1;
  const groupDir = (run) => {
    const lines = run.slice(0, 2).flatMap((n) => n.getKeyProps().map((k) => k.line));
    return lines.reduce((a, b) => a + b, 0) / lines.length >= MIDDLE_LINE ? -1 : 1;
  };
  const throwsOut = (note, dir) => {
    if (note.getStemDirection() === dir) return false;
    const lines = note.getKeyProps().map((k) => k.line);
    return dir === 1 ? Math.max(...lines) > TOP_LINE : Math.min(...lines) < BOTTOM_LINE;
  };
  const plan = (run) => {
    if (run.length < 2) return [];
    const dir = groupDir(run);
    const bad = run.findIndex((n) => throwsOut(n, dir));
    if (bad < 0) return [{ run, dir }];
    return [...plan(run.slice(0, bad)), ...plan(run.slice(bad + 1))];
  };
  const beamRuns = (staffNotes) => {
    const runs = [];
    let group = [];
    const flush = () => { runs.push(...plan(group)); group = []; };
    for (let i = 0; i <= count; i += 1) {
      const note = i < count && durations[i] === '8' ? staffNotes[i] : null;
      if (!note) { flush(); continue; }
      group.push(note);
    }
    flush();
    return runs.map(({ run, dir }) => {
      run.forEach((n) => { if (n.getStemDirection() !== dir) n.setStemDirection(dir); });
      return run;
    });
  };
  let beamGroups = [];
  try {
    beamGroups = [
      ...beamRuns(slotNotes.map((s) => s.tNote)),
      ...beamRuns(slotNotes.map((s) => s.bNote)),
    ];
  } catch { beamGroups = []; }

  const makeVoice = (tickables) =>
    new Voice({ num_beats: Math.max(1, count), beat_value: 4 }).setStrict(false).addTickables(tickables);
  const tVoice = makeVoice(trebleTickables);
  const bVoice = makeVoice(bassTickables);

  // joinVoices puts both staves on shared tick contexts, so a column's treble and
  // bass noteheads share one x — the vertical alignment a grand staff needs. The
  // formatter is run for what it does to each column INSIDE itself (accidental
  // columns, displaced heads, strokes); where the columns go is decided by layoutColumns.
  if (count) {
    new Formatter().joinVoices([tVoice]).joinVoices([bVoice]).format([tVoice, bVoice], 0);
  }

  // PIN EACH COLUMN TO ITS LAID-OUT x. The formatter spaces by ticks, so a duration
  // rewritten retroactively — which happens the moment the next column is struck —
  // would move every column to its right. layoutColumns' positions don't depend on
  // anything to the right, so we place the columns ourselves.
  //
  // It has to be the TICK CONTEXT that moves, not the note's x_shift. In VexFlow 4.2.5
  // a notehead draws at getNoteHeadBeginX() = getAbsoluteX() + x_shift (stavenote.js),
  // but every modifier is laid out from getModifierStartXY(), which is getAbsoluteX() —
  // tickContext.getX() + the stave's note start — WITHOUT the shift (Accidental.draw,
  // Stroke.draw, Annotation.draw all start there). Shifting the notes walked the
  // noteheads into place and left their accidentals, roll strokes and 8va labels where
  // the formatter had put them: the replay of real takes drew sharps to the RIGHT of
  // their notes and strokes a column away from their chords. Moving the tick context
  // moves the note and everything hung on it together. joinVoices put both staves on
  // the same tick contexts, so one setX aligns treble and bass.
  trebleTickables.forEach((t) => t.setStave(treble));
  bassTickables.forEach((t) => t.setStave(bass));
  [trebleTickables, bassTickables].forEach((list) => list.forEach((t, i) => {
    t.getTickContext?.()?.setX(xs[i]);
  }));

  // The beams themselves, now that the notes sit where they will be drawn, and before
  // the draw so the notes suppress their own flags. Decorative — a beam failure must not
  // cost the staff, the same bargain the ottava markers make.
  let beams = [];
  try { beams = beamGroups.map((group) => new Beam(group, false)); } catch { beams = []; }

  if (count) {
    tVoice.draw(ctx, treble);
    bVoice.draw(ctx, bass);
  }
  try { beams.forEach((b) => b.setContext(ctx).draw()); } catch { /* decorative */ }

  // Say which staff and which column each drawn note belongs to, on its SVG group. The
  // geometry can't: a treble chord below middle C reaches into the bass staff's height.
  // The ink sweep reads these to check neighbouring columns on one staff for collisions.
  slotNotes.forEach(({ tNote, bNote }, i) => {
    for (const [note, staff] of [[tNote, 'treble'], [bNote, 'bass']]) {
      const el = note && host.querySelector(`[id="vf-${note.getAttribute('id')}"]`);
      if (el) { el.setAttribute('data-staff', staff); el.setAttribute('data-column', String(i)); }
    }
  });

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
