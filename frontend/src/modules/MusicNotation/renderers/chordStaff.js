// chordStaff — engrave the live "current chord" as a grand staff via VexFlow
// (SVG backend). The stave is drawn to FILL its host box width (its logical width
// tracks the measured box aspect, so the viewBox aspect equals the box aspect and
// the staff lines span edge-to-edge with no side gutters). The width is fixed by
// the box, NOT by the chord — so it never jumps as you play, always leaves room
// for the clef + key signature + notes, and content that would overrun it is
// trimmed by the host's overflow:hidden. Clef → key signature → chord flow from
// the left, as in normal notation.
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
const TOP_ROOM = 14;    // room above the treble staff (clef overshoot + high ledger notes)
const BOTTOM_ROOM = 72; // room below the bass staff for LOW ledger notes (don't clip them)
const STAFF_GAP = 66;   // treble top line → bass top line (one grand-staff system)
const BASS_STAFF_H = 40;
const INK = '#1a1a1a';
const MIN_NOTE_AREA = 40;

/**
 * Stave/viewBox geometry for a given key-sig accidental count and host box aspect
 * (w/h). The stave is sized to FILL the box: its width tracks the box aspect so
 * the viewBox aspect equals the box aspect (staff lines span the full width, no
 * gutters). Floored at the content minimum so a narrow slot still fits the clef +
 * key signature + a note; deliberately NO upper cap — the stave fills however wide
 * the slot is, and overrun content is trimmed by the host's overflow. Width is a
 * function of the BOX, not the chord, so it stays fixed as notes change.
 */
export function computeChordStaffLayout(accCount, aspect) {
  const logicalH = TOP_ROOM + STAFF_GAP + BASS_STAFF_H + BOTTOM_ROOM;
  const minStaveW = 44 + accCount * 10 + MIN_NOTE_AREA;
  const valid = Number.isFinite(aspect) && aspect > 0;
  const target = valid ? Math.round(logicalH * aspect) - PAD * 2 : minStaveW;
  const staveW = Math.max(minStaveW, target);
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
  return new StaveNote({ keys: midis.map((m) => midiToVexKey(m, keySig)), duration: 'q', clef });
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

  // Stave geometry: WIDTH FILLS the host box (tracks its aspect ratio) so the staff
  // lines span edge-to-edge with no dead gutters, floored at the content minimum for
  // narrow slots. Extra top/bottom room keeps low-register ledger notes in frame and
  // lets the taller viewBox scale the engraving under `meet`.
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

  // Content flows from the LEFT (clef → key signature → chord); the stave lines run
  // full width to the right. The formatter parks a single chord just after the key
  // signature, which is exactly what we want now — a small fixed inset gives it a
  // little air so it isn't jammed against the accidentals. (No centering: on a wide
  // fill-the-width stave, centering would strand the chord alone in the middle.)
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
