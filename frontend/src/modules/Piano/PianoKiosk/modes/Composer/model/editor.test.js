import { describe, it, expect } from 'vitest';
import { initEditor, replacePitch, serializeFromEditor, insertNote } from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote, noteDivisions } from './note.js';
import { parseMusicXml } from '#frontend/modules/MusicNotation/parseMusicXml.js';

function oneNoteEditor() {
  const s = makeEmptyScore();
  s.parts[0].measures[0].notes = [makeNote({ step: 'C', octave: 4 }, { type: 'quarter' })];
  return initEditor(s);
}

function twoFourEditor() {
  return initEditor(makeEmptyScore({ time: { beats: 2, beatType: 4 } }));
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
  it('preserves lyric/dynamics/articulations on the rebuilt note (only pitch changes)', () => {
    const s = makeEmptyScore();
    s.parts[0].measures[0].notes = [makeNote(
      { step: 'C', octave: 4 },
      { type: 'quarter', lyric: 'la', dynamics: 'mf', articulations: ['staccato'] },
    )];
    const ed0 = initEditor(s);
    const ed1 = replacePitch(ed0, { measureIdx: 0, noteIdx: 0 }, { step: 'G', octave: 4 });
    const note = ed1.score.parts[0].measures[0].notes[0];
    expect(note.lyric).toBe('la');
    expect(note.dynamics).toBe('mf');
    expect(note.articulations).toEqual(['staccato']);
    // only pitch/midi changed
    expect(note.midi).toBe(67);
    expect(note.pitch.step).toBe('G');
    expect(note.type).toBe('quarter');
  });
});

describe('serializeFromEditor', () => {
  it('serializes the editor score to MusicXML', () => {
    const xml = serializeFromEditor(oneNoteEditor());
    expect(xml).toContain('<score-partwise');
  });
});

describe('insertNote — within a bar', () => {
  it('appends within a bar and advances the caret', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(ed.score.parts[0].measures[0].notes).toHaveLength(1);
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 1 });
  });
});

describe('insertNote — auto-bar split/tie', () => {
  it('splits an over-long note across the barline with a tied chain (multi-piece)', () => {
    let ed = initEditor(makeEmptyScore()); // 4/4
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'half', dots: 1 }); // 3 beats
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'eighth' });        // 0.5 → 3.5 total
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'half' });          // 2 beats; 0.5 fits in bar 1, 1.5 spills
    const bar0 = ed.score.parts[0].measures[0].notes;
    const bar1 = ed.score.parts[0].measures[1].notes;
    // Head: room in bar0 = 0.5 beat = 12 divs = one eighth → tie 'start'.
    expect(bar0[bar0.length - 1].tie).toBe('start');
    expect(bar0[bar0.length - 1].midi).toBe(62);
    // Spill: 1.5 beats = 36 divs = decompose → [quarter(24), eighth(12)] → 2 pieces.
    // Full 3-piece tie chain across the barline is start → both → stop, so the
    // FIRST spill piece is 'both' (not 'stop') — corrected from the spec's
    // 2-piece assumption to the musically-correct multi-piece chain.
    expect(bar1[0].tie).toBe('both');
    expect(bar1[0].midi).toBe(62);
    expect(bar1[1].tie).toBe('stop');
    expect(bar1[1].midi).toBe(62);
    // Spilled D4 pieces preserve the remaining 1.5 beats (36 divisions).
    expect(bar1.reduce((s, n) => s + noteDivisions(n), 0)).toBe(36);
  });
  it('splits with single-piece head and single-piece tail (start → stop)', () => {
    let ed = initEditor(makeEmptyScore()); // 4/4
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'half', dots: 1 }); // 3 beats fills to 72/96
    ed = insertNote(ed, { step: 'E', octave: 4 }, { type: 'half' });          // 2 beats; 1 fits, 1 spills
    const bar0 = ed.score.parts[0].measures[0].notes;
    const bar1 = ed.score.parts[0].measures[1].notes;
    // room = 24 divs = quarter (head, 'start'); spill = 24 divs = quarter (tail, 'stop').
    expect(bar0[bar0.length - 1].tie).toBe('start');
    expect(bar0[bar0.length - 1].midi).toBe(64);
    expect(bar1[0].tie).toBe('stop');
    expect(bar1[0].midi).toBe(64);
    expect(bar1).toHaveLength(1);
  });
  it('creates a second measure and moves the caret into it', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'whole' }); // fills bar exactly
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' }); // starts bar 2
    expect(ed.score.parts[0].measures).toHaveLength(2);
    expect(ed.caret.measureIdx).toBe(1);
  });
  it('does not mutate the input state (immutability)', () => {
    const ed0 = initEditor(makeEmptyScore());
    const ed1 = insertNote(ed0, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(ed0.score.parts[0].measures[0].notes).toHaveLength(0);
    expect(ed1.score.parts[0].measures[0].notes).toHaveLength(1);
  });
  it('distributes a note larger than a bar across MULTIPLE bars as one tied chain', () => {
    // 2/4 (cap 48). Fill a quarter (room 24), then insert a whole note (96 divs)
    // → chunks 24 | 48 | 24 across bars 0, 1, 2. One tie chain: start → both → stop.
    let ed = twoFourEditor();
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = insertNote(ed, { step: 'A', octave: 4 }, { type: 'whole' });
    const measures = ed.score.parts[0].measures;
    // The A4 chain spans 3 bars: bar0 tail piece, bar1, bar2.
    const chain = [];
    for (const m of measures) for (const n of m.notes) if (n.midi === 69) chain.push(n);
    expect(chain).toHaveLength(3);
    expect(chain[0].tie).toBe('start');
    expect(chain[chain.length - 1].tie).toBe('stop');
    for (let i = 1; i < chain.length - 1; i++) expect(chain[i].tie).toBe('both');
    // all same pitch, and the total placed duration equals the original whole note (96).
    expect(chain.every((n) => n.midi === 69)).toBe(true);
    expect(chain.reduce((s, n) => s + noteDivisions(n), 0)).toBe(96);
    // three bars materialized; caret lands after the last placed piece.
    expect(measures).toHaveLength(3);
    expect(ed.caret).toEqual({ measureIdx: 2, noteIdx: 1 });
  });
  it('v1 limitation: appends at end even when caret.noteIdx points mid-measure', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' }); // [C]
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' }); // [C, D]
    ed = { ...ed, caret: { measureIdx: 0, noteIdx: 0 } }; // move caret to the front
    ed = insertNote(ed, { step: 'E', octave: 4 }, { type: 'quarter' }); // still appends at END
    const midis = ed.score.parts[0].measures[0].notes.map((n) => n.midi);
    expect(midis).toEqual([60, 62, 64]); // E landed at the end, not at noteIdx 0
  });
});
