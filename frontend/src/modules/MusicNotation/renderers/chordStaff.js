// chordStaff — engrave the live "current chord" as a compact, self-centering
// grand staff via VexFlow (SVG backend). Unlike the abcjs path, the staff is
// drawn at an EXACT, content-sized viewBox (clef + key signature + one chord,
// nothing more) and the whole fixed-size SVG is centered by its container — so
// there's no container-width-vs-scale fight, no overflow clipping, and the chord
// sits centered by construction regardless of how high/low it is.
//
// Spelling is key-signature aware: each MIDI note is given its true letter+alter,
// then VexFlow's Accidental.applyAccidentals draws only the accidentals the key
// signature doesn't already imply (in-key notes are clean; out-of-key get a
// sharp/flat/natural). This is why we can't reuse midiToAbc, which omits the
// accidental for in-key notes and leans on the ABC `K:` header instead.
import { Renderer, Stave, StaveNote, Voice, Formatter, StaveConnector, Accidental, Annotation } from 'vexflow';
import { KEY_SIGNATURES } from '../model/keySignature.js';
import { splitByHand, getOttavaInfo } from '../model/handSplit.js';

const PAD = 8;
const STAFF_GAP = 66; // treble top line → bass top line (one grand-staff system)
const INK = '#1a1a1a';

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
 * @param {{ notes?: Map<number, any>, keySignature?: string }} opts
 */
export function renderChordStaff(host, { notes, keySignature = 'C' } = {}) {
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

  // Content-sized stave: clef + key signature + one chord. No trailing staff.
  const staveW = 54 + accCount * 10 + 48;
  const logicalW = staveW + PAD * 2;
  const logicalH = PAD * 2 + STAFF_GAP + 78;

  // Fit the fixed-size engraving to the column (cap up/down-scaling). The SVG is
  // then centered by its flex container, so the staff is centered as one unit.
  const containerW = host.parentElement?.clientWidth || host.clientWidth || logicalW;
  const scale = Math.max(0.6, Math.min(2.4, (containerW * 0.92) / logicalW));

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(Math.round(logicalW * scale), Math.round(logicalH * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(INK);
  ctx.setStrokeStyle(INK);

  const treble = new Stave(PAD, PAD, staveW);
  const bass = new Stave(PAD, PAD + STAFF_GAP, staveW);
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

  const noteAreaW = Math.max(20, staveW - (treble.getNoteStartX() - treble.getX()) - 14);
  const drawVoice = (note, stave) => {
    if (!note) return;
    const v = new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false).addTickables([note]);
    Accidental.applyAccidentals([v], ks);
    new Formatter().joinVoices([v]).format([v], noteAreaW);
    v.draw(ctx, stave);
  };
  drawVoice(tNote, treble);
  drawVoice(bNote, bass);
}

export default renderChordStaff;
