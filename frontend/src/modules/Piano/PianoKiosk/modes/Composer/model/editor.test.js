import { describe, it, expect } from 'vitest';
import { initEditor, replacePitch, serializeFromEditor } from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote } from './note.js';
import { parseMusicXml } from '#frontend/modules/MusicNotation/parseMusicXml.js';

function oneNoteEditor() {
  const s = makeEmptyScore();
  s.parts[0].measures[0].notes = [makeNote({ step: 'C', octave: 4 }, { type: 'quarter' })];
  return initEditor(s);
}

describe('initEditor', () => {
  it('starts disarmed, quarter sticky, caret at 0/0, no selection', () => {
    const ed = initEditor(makeEmptyScore());
    expect(ed.armed).toBe(false);
    expect(ed.stickyDuration).toEqual({ type: 'quarter', dots: 0, triplet: false });
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 0 });
    expect(ed.selection).toBeNull();
  });
  it('maps a parsed score.composer into composerName (load-adapter reconcile)', () => {
    // parseMusicXml produces score.composer; the editor model uses composerName.
    const parsed = parseMusicXml(`<?xml version="1.0"?><score-partwise>
      <identification><creator type="composer">Ada</creator></identification>
      <part-list><score-part id="P1"/></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>24</divisions></attributes></measure></part></score-partwise>`);
    const ed = initEditor(parsed);
    expect(ed.score.composerName).toBe('Ada');
  });
});

describe('replacePitch', () => {
  it('replaces a note pitch immutably (C4 → G4), leaving duration', () => {
    const ed0 = oneNoteEditor();
    const ed1 = replacePitch(ed0, { measureIdx: 0, noteIdx: 0 }, { step: 'G', octave: 4 });
    expect(ed1.score.parts[0].measures[0].notes[0].midi).toBe(67);
    expect(ed1.score.parts[0].measures[0].notes[0].type).toBe('quarter');
    expect(ed0.score.parts[0].measures[0].notes[0].midi).toBe(60); // original untouched (immutability)
  });
});

describe('serializeFromEditor', () => {
  it('serializes the editor score to MusicXML', () => {
    const xml = serializeFromEditor(oneNoteEditor());
    expect(xml).toContain('<score-partwise');
  });
});
