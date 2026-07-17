// index.test.js — smoke test the public API barrel re-exports the model surface.
import { describe, it, expect } from 'vitest';
import {
  makeEmptyScore, makeNote, makeRest, noteDivisions,
  initEditor, replacePitch, insertNote, insertRest, deleteNote,
  setDuration, toggleDot, toggleTriplet, toggleTie, nudgePitch,
  moveCaret, select, setAttribute, serializeFromEditor,
  applyCommand, withHistory, undo, redo,
  serializeMusicXml, parseMusicXml,
} from './index.js';

describe('public model API barrel', () => {
  it('re-exports the core factory + command functions', () => {
    for (const fn of [
      makeEmptyScore, makeNote, makeRest, noteDivisions,
      initEditor, replacePitch, insertNote, insertRest, deleteNote,
      setDuration, toggleDot, toggleTriplet, toggleTie, nudgePitch,
      moveCaret, select, setAttribute, serializeFromEditor,
      applyCommand, withHistory, undo, redo,
      serializeMusicXml, parseMusicXml,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('the barrel is wired end-to-end (make → edit → serialize)', () => {
    const ed = initEditor(makeEmptyScore());
    expect(typeof serializeFromEditor(ed)).toBe('string');
  });
});
