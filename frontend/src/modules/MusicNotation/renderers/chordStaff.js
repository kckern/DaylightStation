// chordStaff — engrave the live "current chord" as a grand staff via VexFlow
// (SVG backend). The stave takes a NATURAL width that tracks the box aspect but is
// CAPPED (see MAX_STAVE_ASPECT) so it never stretches edge-to-edge across a wide
// pane. When the cap bites, the viewBox is narrower than the pane, and the SVG's
// preserveAspectRatio="xMidYMid meet" centers the whole compact staff with air on
// both sides — centering is done by the viewBox under `meet`, NOT by shifting the
// note. Width is a function of the BOX (clamped), NOT the chord, so it never jumps
// as you play and always leaves room for clef + key signature + notes. Clef → key
// signature → chord flow from the left, as in normal notation.
//
// Spelling is key-signature aware: each MIDI note is given its true letter+alter,
// then VexFlow's Accidental.applyAccidentals draws only the accidentals the key
// signature doesn't already imply (in-key notes are clean; out-of-key get a
// sharp/flat/natural). This is why we can't reuse midiToAbc, which omits the
// accidental for in-key notes and leans on the ABC `K:` header instead.
import { Renderer, Stave, StaveNote, Voice, Formatter, StaveConnector, Accidental, Annotation } from 'vexflow';
import { KEY_SIGNATURES } from '../model/keySignature.js';
import { splitByHand, getOttavaInfo } from '../model/handSplit.js';

const PAD = 8;          // horizontal margin (left/right) inside the viewBox
// Real vertical headroom so tall chords never clip. The two sides are ASYMMETRIC
// because the ottava thresholds are: the treble shifts only above 93, so the worst
// UNSHIFTED treble note is A6 (93) ≈ 50px above the top line → TOP_ROOM 58 gives ~8px
// of real margin. The bass shifts below 40, so the worst UNSHIFTED bass note is E2
// (40) ≈ 18px below the bottom line → BOTTOM_ROOM 44 is ample (and comfortably above
// the minimum). auto_stem points the stem TOWARD the staff, so it doesn't add to the
// overhang on the far side. logicalH = 58 + 66 + 40 + 44 = 208 (vs. the old 192, ≈ +8%
// taller → slightly smaller engraving under `meet`, the cost of real top headroom).
const TOP_ROOM = 58;    // room above the treble staff for HIGH ledger notes (worst unshifted A6 ≈ 50px)
const BOTTOM_ROOM = 44; // room below the bass staff for LOW ledger notes (worst unshifted E2 ≈ 18px)
const STAFF_GAP = 66;   // treble top line → bass top line (one grand-staff system)
const BASS_STAFF_H = 40;
const INK = '#1a1a1a';
const MIN_NOTE_AREA = 40;

const MAX_STAVE_ASPECT = 1.7; // cap the stave's natural width at ~1.7:1 (w/h)

/**
 * Stave/viewBox geometry for a given key-sig accidental count and host box aspect
 * (w/h). The stave takes a NATURAL width that tracks the box aspect, floored at the
 * content minimum (so a narrow slot still fits clef + key signature + a note) and
 * CAPPED at MAX_STAVE_ASPECT so it never stretches edge-to-edge across a wide pane.
 * When the cap bites, the viewBox is narrower than the pane and the SVG's `meet`
 * fit centers the whole staff with air on both sides. Width is a function of the
 * BOX (clamped), not the chord, so it stays fixed as notes change.
 */
export function computeChordStaffLayout(accCount, aspect) {
  const logicalH = TOP_ROOM + STAFF_GAP + BASS_STAFF_H + BOTTOM_ROOM;
  const minStaveW = 44 + accCount * 10 + MIN_NOTE_AREA;
  const maxStaveW = Math.round(logicalH * MAX_STAVE_ASPECT) - PAD * 2;
  const valid = Number.isFinite(aspect) && aspect > 0;
  const staveW = valid
    ? Math.max(minStaveW, Math.min(Math.round(logicalH * aspect) - PAD * 2, maxStaveW))
    : minStaveW;
  return { staveW, logicalW: staveW + PAD * 2, logicalH };
}

// pitch-class → [letter, alter] spelled with sharps (default / sharp keys)…
const SHARP_SPELL = [['c', 0], ['c', 1], ['d', 0], ['d', 1], ['e', 0], ['f', 0], ['f', 1], ['g', 0], ['g', 1], ['a', 0], ['a', 1], ['b', 0]];
// …or with flats (used when the key signature is a flat key).
const FLAT_SPELL = [['c', 0], ['d', -1], ['d', 0], ['e', -1], ['e', 0], ['f', 0], ['g', -1], ['g', 0], ['a', -1], ['a', 0], ['b', -1], ['b', 0]];

/**
 * MIDI → VexFlow key string (e.g. `f#/3`, `bb/4`, `c/4`), spelled toward the
 * key signature's accidental flavor. The accidental glyph carries the note's
 * TRUE alteration; display is decided later by Accidental.applyAccidentals.
 */
export function midiToVexKey(midi, keySig = 'C') {
  const pc = (((midi % 12) + 12) % 12);
  const octave = Math.floor(midi / 12) - 1;
  const useFlat = (KEY_SIGNATURES[keySig]?.flats?.length || 0) > 0;
  const [letter, alter] = (useFlat ? FLAT_SPELL : SHARP_SPELL)[pc];
  const glyph = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  return `${letter}${glyph}/${octave}`;
}

function chordNote(midis, clef, keySig) {
  if (!midis.length) return null;
  // auto_stem: high chords stem DOWN and low chords stem UP (stems point toward the
  // staff), so the stem no longer adds to a tall chord's overhang and the noteheads
  // stay within TOP_ROOM/BOTTOM_ROOM instead of clipping.
  return new StaveNote({ keys: midis.map((m) => midiToVexKey(m, keySig)), duration: 'q', clef, auto_stem: true });
}

/**
 * Render the current chord onto `host` as a centered grand staff.
 *
 * @param {HTMLElement} host
 * @param {{ notes?: Map<number, any>, keySignature?: string, aspect?: number }} opts
 */
export function renderChordStaff(host, { notes, keySignature = 'C', aspect } = {}) {
  if (!host) return;
  host.innerHTML = '';

  const midis = notes ? [...notes.keys()].sort((a, b) => a - b) : [];
  const { bassNotes, trebleNotes } = splitByHand(midis);
  const trebleOtt = getOttavaInfo(trebleNotes, true);
  const bassOtt = getOttavaInfo(bassNotes, false);
  // Shift extreme notes back toward the staff (mirrors generateAbc) so the
  // viewBox stays compact instead of sprouting a tower of ledger lines.
  const dispTreble = trebleOtt.octaves ? trebleNotes.map((n) => n - trebleOtt.octaves * 12) : trebleNotes;
  const dispBass = bassOtt.octaves ? bassNotes.map((n) => n + bassOtt.octaves * 12) : bassNotes;

  const ks = KEY_SIGNATURES[keySignature] ? keySignature : 'C';
  const accCount = KEY_SIGNATURES[ks].sharps.length + KEY_SIGNATURES[ks].flats.length;

  // Stave geometry: WIDTH tracks the host box aspect but is CAPPED (MAX_STAVE_ASPECT)
  // so a wide pane doesn't stretch the staff edge-to-edge — the capped viewBox is
  // narrower than the pane and `meet` centers it with air on both sides. Floored at
  // the content minimum for narrow slots. TOP_ROOM/BOTTOM_ROOM give real headroom so
  // high and low ledger notes stay in frame instead of clipping.
  const { staveW, logicalW, logicalH } = computeChordStaffLayout(accCount, aspect);

  // Render at LOGICAL units (no container-width math, no scale cap). The SVG is
  // given a viewBox so the browser scales the whole engraving to fit its box and
  // centers it (preserveAspectRatio) — resolution/DPR independent, never clipped.
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(logicalW, logicalH);
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

  const tNote = chordNote(dispTreble, 'treble', ks);
  const bNote = chordNote(dispBass, 'bass', ks);
  // Best-effort 8va/8vb markers on the shifted chord (don't fail the render if
  // the Annotation enum shape ever shifts between VexFlow versions).
  try {
    if (trebleOtt.marker && tNote) tNote.addModifier(new Annotation(trebleOtt.marker).setVerticalJustification(Annotation.VerticalJustify.TOP));
    if (bassOtt.marker && bNote) bNote.addModifier(new Annotation(bassOtt.marker).setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
  } catch { /* marker is decorative */ }

  // Content flows from the LEFT (clef → key signature → chord). The formatter parks a
  // single chord just after the key signature; a small fixed inset gives it a little
  // air so it isn't jammed against the accidentals. We do NOT center by shifting the
  // note — treble and bass are formatted independently, so a per-note shift would
  // stagger the two hands. Whole-staff centering is done by the capped viewBox under
  // `meet` (see computeChordStaffLayout), which keeps the two hands aligned.
  const noteAreaW = Math.max(20, staveW - (treble.getNoteStartX() - treble.getX()) - 14);
  const NOTE_INSET = 10; // logical units of air after the key signature
  const drawVoice = (note, stave) => {
    if (!note) return;
    const v = new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false).addTickables([note]);
    Accidental.applyAccidentals([v], ks);
    new Formatter().joinVoices([v]).format([v], noteAreaW);
    note.setXShift(NOTE_INSET);
    v.draw(ctx, stave);
  };
  drawVoice(tNote, treble);
  drawVoice(bNote, bass);

  // Make the SVG fluid: a viewBox lets the browser scale the engraving to fit its
  // container and center it (xMidYMid meet), preserving aspect ratio. Replaces the
  // fixed px width/height VexFlow stamps on — so it never overflows or clips.
  const svg = host.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${logicalW} ${logicalH}`);
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
