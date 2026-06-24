// MusicNotation — shared music model + pluggable notation renderers.
//
// One model (pitch spelling, key signatures, hand inference) feeds multiple
// renderers (abcjs grand staff, hand-rolled SVG staff, future MusicXML/OSMD).
// Also the theory grading engine (tonal) consumes the same model conceptually.

// Model
export { WHITE_KEYS, NOTE_TO_DIATONIC, isBlackKey, spellAccidental, getStaffPosition } from './model/pitch.js';
export { KEY_SIGNATURES, NATURAL_NOTES, PITCH_TO_NATURAL, detectKey } from './model/keySignature.js';
export { splitByHand, getOttavaInfo } from './model/handSplit.js';
export { diatonicTranspose, expandDrill, handMidiSequence } from './model/drillTranspose.js';

// Renderers
export { AbcRenderer } from './renderers/AbcRenderer.jsx';
export { SvgStaffRenderer } from './renderers/SvgStaffRenderer.jsx';
export { MusicXmlRenderer } from './renderers/MusicXmlRenderer.jsx';
export { midiToAbc, generateAbc, generateMelodyAbc } from './renderers/abc.js';

// Facade
export { Notation } from './Notation.jsx';
