// index.js — public model API barrel for the Composer core (P1).
//
// The (future) UI layer imports the composer model surface from here rather than
// reaching into individual files. No behavior lives here; this is the seam.
export { makeEmptyScore } from './score.js';
export { makeNote, makeRest, noteDivisions } from './note.js';
export {
  initEditor, replacePitch, insertNote, insertRest, deleteNote,
  setDuration, toggleDot, toggleTriplet, toggleTie, nudgePitch,
  moveCaret, select, setAttribute, serializeFromEditor,
} from './editor.js';
export { applyCommand, withHistory, undo, redo } from './history.js';
export { serializeMusicXml } from '@/modules/MusicNotation/serializeMusicXml.js';
export { parseMusicXml } from '@/modules/MusicNotation/parseMusicXml.js';
