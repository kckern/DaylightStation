import { describe, it, expect } from 'vitest';
import { pendingAppendDiff } from './wetInk.js';
import { makeEmptyScore, makeNote } from './model/index.js';
import { initEditor, insertNote, deleteNote, moveCaret, setAttribute } from './model/editor.js';

const C4 = { step: 'C', octave: 4, alter: 0 };

/** Build a real score carrying `n` quarter notes, through the real editor API. */
function withNotes(n) {
  let s = initEditor(makeEmptyScore());
  for (let i = 0; i < n; i++) s = insertNote(s, C4, { type: 'quarter' });
  return s.score;
}

describe('pendingAppendDiff', () => {
  it('reports no change for identical scores', () => {
    const a = withNotes(2);
    expect(pendingAppendDiff(a, withNotes(2))).toEqual({ measureIdx: null, notes: [] });
  });

  it('reports a single appended note as wet ink in its measure', () => {
    const diff = pendingAppendDiff(withNotes(2), withNotes(3));
    expect(diff.measureIdx).toBe(0);
    expect(diff.notes).toHaveLength(1);
    expect(diff.notes[0].pitch).toEqual(C4);
  });

  it('reports several appended notes at once', () => {
    const diff = pendingAppendDiff(withNotes(1), withNotes(3));
    expect(diff.measureIdx).toBe(0);
    expect(diff.notes).toHaveLength(2);
  });

  it('demands a settle when a note was deleted', () => {
    const settled = withNotes(3);
    const live = deleteNote(initEditor(settled), { measureIdx: 0, noteIdx: 1 }).score;
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when an existing note changed', () => {
    const settled = withNotes(3);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes[0].pitch.step = 'D';
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when two different measures grew', () => {
    const settled = withNotes(5); // bar 0 full (4 quarters), bar 1 holds 1
    expect(settled.parts[0].measures).toHaveLength(2);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes.push(makeNote(C4, { type: 'quarter' }));
    live.parts[0].measures[1].notes.push(makeNote(C4, { type: 'quarter' }));
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // A new measure means a new BARLINE, which the lightweight wet-ink layer cannot
  // draw — only an OSMD engrave can. insertNote opens the next measure both when a
  // note exactly fills the bar and when one straddles it, so both must settle.
  it('demands a settle when the note that exactly fills the bar opens a new measure', () => {
    const settled = withNotes(3);
    const live = withNotes(4);
    expect(settled.parts[0].measures).toHaveLength(1);
    expect(live.parts[0].measures).toHaveLength(2);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when a note straddles the barline into a new measure', () => {
    const settled = withNotes(3); // 72 of 96 divisions used → 24 left
    const live = insertNote(initEditor(settled), C4, { type: 'whole' }).score;
    expect(live.parts[0].measures.length).toBeGreaterThan(1);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Wet ink can only paint past the end of the engraving; growing an earlier
  // measure reflows every bar to its right. deleteNote doesn't reflow, so this
  // shape is reachable by ordinary input: fill a bar, delete from it, walk the
  // caret back, type.
  it('demands a settle when the grown measure is not the last one', () => {
    let s = initEditor(makeEmptyScore());
    for (let i = 0; i < 5; i++) s = insertNote(s, C4, { type: 'quarter' });
    s = deleteNote(s, { measureIdx: 0, noteIdx: 1 }); // bar 0 now underfull
    const settled = s.score;
    expect(settled.parts[0].measures).toHaveLength(2);

    s = moveCaret(s, 'prevBar');
    expect(s.caret.measureIdx).toBe(0);
    const live = insertNote(s, C4, { type: 'quarter' }).score;

    // The append really did land in the non-final bar 0, and it must still settle.
    expect(live.parts[0].measures[0].notes).toHaveLength(4);
    expect(live.parts[0].measures).toHaveLength(2);
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Forward-looking: unreachable from the Composer input path today, but a chord
  // member shares its principal's onset and would be mis-drawn as a sequential
  // note by the wet-ink layer.
  it('demands a settle when an appended note is a chord member', () => {
    const settled = withNotes(2);
    const live = structuredClone(settled);
    live.parts[0].measures[0].notes.push(makeNote(C4, { type: 'quarter', chord: true }));
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('demands a settle when the part count differs', () => {
    const settled = withNotes(2);
    const live = structuredClone(settled);
    live.parts.push({ id: 'P2', name: 'Music', staves: 1, clefs: {}, measures: [{ number: 1, notes: [] }] });
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  // Score-level attribute edits touch no note, so a notes-only comparison would
  // read them as "nothing changed" and the caller would never engrave the new key
  // signature. The envelope is compared too, precisely to close that hole.
  it('demands a settle when a score attribute changed but no note did', () => {
    const settled = withNotes(2);
    const live = setAttribute(initEditor(settled), 'key', { fifths: 2 }).score;
    expect(pendingAppendDiff(settled, live)).toBeNull();
  });

  it('treats a missing or malformed score as a settle rather than a no-op', () => {
    expect(pendingAppendDiff(withNotes(2), null)).toBeNull();
    expect(pendingAppendDiff(null, withNotes(2))).toBeNull();
  });
});
