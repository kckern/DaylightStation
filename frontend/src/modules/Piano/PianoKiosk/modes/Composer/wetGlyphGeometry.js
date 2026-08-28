// wetGlyphGeometry.js — staff-position math + spacing constants shared by
// wetGlyphs.jsx's WetNoteGlyph and its callers (EditorSurface, PendingLayer),
// split out so Fast Refresh can hot-reload the glyph component on its own.
import { MIDDLE_LINE, STEM_LEN_UNITS, STEM_MIN_UNITS, stemDirectionFor, stemLengthUnits } from '../../../../MusicNotation/model/stems.js';

export { MIDDLE_LINE, STEM_LEN_UNITS, STEM_MIN_UNITS, stemDirectionFor, stemLengthUnits };

const STEP_DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Absolute diatonic index, matching MusicNotation/model/pitch.js's convention
// (C4 = 28, E4 = 30).
const absDiatonic = ({ step, octave }) => octave * 7 + (STEP_DIATONIC[step] ?? 0);

// Bottom staff line as an absolute diatonic index: treble = E4 (30), bass = G2
// (18) — the same constants pitch.js uses.
const bottomLineDiatonic = (clef) => (clef?.sign === 'F' ? 18 : 30);

/**
 * Staff HALF-STEPS above the bottom line: 0 = bottom line, 1 = the space above
 * it, 2 = the next line up; negative = below the staff.
 *
 * Deliberately NOT routed through pitch.js's getStaffPosition(midiNote), for two
 * reasons. (1) That helper picks the clef FROM the pitch (absDiatonic >= 28 →
 * treble), but the Composer is a fixed-clef staff — anything a left hand plays
 * would be measured against a bass staff bottom line while the engraving shows
 * treble. (2) Going pitch → MIDI → position throws away the spelling the model
 * already stores: C#4 and Db4 are one MIDI number but two different staff lines,
 * and the helper would re-guess between them. `step` is both simpler and right.
 */
export const staffPositionOf = (pitch, clef) => absDiatonic(pitch) - bottomLineDiatonic(clef);

// Wet-ink glyph geometry, in staff-line-spacing units (the engraving zoom
// varies, so nothing here can be a pixel constant). Notehead proportions come
// from DurationPalette's NoteGlyph (rx 5 / ry 3.4), rescaled.
//
// EXPORTED because EditorSurface must agree with them: it computes `anchorX`
// (where note 0 paints) and the wet caret position (which clears the LAST
// note's right edge) from the same numbers. Tuning note spacing here without
// them would silently drift the anchor and the caret off the glyphs.
export const WET_ADVANCE_UNITS = 2.4; // note centre → next note centre
export const WET_RX_UNITS = 0.62;     // notehead half-width
