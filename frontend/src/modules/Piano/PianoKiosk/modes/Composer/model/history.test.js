import { describe, it, expect } from 'vitest';
import { initEditor, insertNote, moveCaret } from './editor.js';
import { makeEmptyScore } from './score.js';
import { applyCommand, withHistory, undo, redo, HISTORY_CAP } from './history.js';

const noteCount = (ed) =>
  ed.score.parts[0].measures.reduce((s, m) => s + m.notes.filter((n) => !n.chord).length, 0);

describe('undo/redo snapshot ring', () => {
  it('undo restores the prior score, redo re-applies it', () => {
    let ed = initEditor(makeEmptyScore());
    ed = applyCommand(ed, insertNote, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(noteCount(ed)).toBe(1);
    ed = undo(ed);
    expect(noteCount(ed)).toBe(0);
    ed = redo(ed);
    expect(noteCount(ed)).toBe(1);
  });

  it('withHistory produces an equivalent history-recording command', () => {
    const insertNoteH = withHistory(insertNote);
    let ed = initEditor(makeEmptyScore());
    ed = insertNoteH(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(ed.history.past).toHaveLength(1);
    ed = undo(ed);
    expect(noteCount(ed)).toBe(0);
  });

  it('a new command after undo clears the redo future', () => {
    let ed = initEditor(makeEmptyScore());
    ed = applyCommand(ed, insertNote, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = undo(ed);
    expect(ed.history.future).toHaveLength(1);
    ed = applyCommand(ed, insertNote, { step: 'D', octave: 4 }, { type: 'quarter' });
    expect(ed.history.future).toHaveLength(0);
    expect(redo(ed)).toBe(ed); // nothing to redo
  });

  it('caret moves do NOT push history', () => {
    let ed = initEditor(makeEmptyScore());
    ed = applyCommand(ed, insertNote, { step: 'C', octave: 4 }, { type: 'quarter' });
    const pastLenBefore = ed.history.past.length;
    ed = applyCommand(ed, moveCaret, 'left');
    ed = applyCommand(ed, moveCaret, 'right');
    expect(ed.history.past.length).toBe(pastLenBefore); // unchanged by caret moves
  });

  it('undo/redo at the ends are no-ops', () => {
    const ed = initEditor(makeEmptyScore());
    expect(undo(ed)).toBe(ed);
    expect(redo(ed)).toBe(ed);
  });

  it('caps the past ring at HISTORY_CAP (oldest dropped)', () => {
    let ed = initEditor(makeEmptyScore());
    for (let i = 0; i < HISTORY_CAP + 50; i++) {
      ed = applyCommand(ed, insertNote, { step: 'C', octave: 4 }, { type: 'quarter' });
    }
    expect(ed.history.past.length).toBeLessThanOrEqual(HISTORY_CAP);
    expect(ed.history.past.length).toBe(HISTORY_CAP);
  });

  it('history is additive to the state shape (initEditor seeds it)', () => {
    const ed = initEditor(makeEmptyScore());
    expect(ed.history).toEqual({ past: [], future: [] });
  });
});
