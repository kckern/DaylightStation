// dataLoss.test.js — the canonical data-loss invariant (Unit 9, the P1 gate).
//
// The reason this whole design exists: load a song → edit ONE note → save →
// reload → every OTHER element survives unchanged. These tests exercise the REAL
// pipeline (parseMusicXml → initEditor → command → serializeFromEditor →
// parseMusicXml), not mocks, and cover three surfaces:
//   1. a real grand-staff fixture (measure/note counts survive an edit)
//   2. rich annotations on an UNRELATED note survive an edit elsewhere
//   3. an annotated note that auto-splits across a barline keeps its annotation
//      exactly once (the splitElement / C1 path)
import { describe, it, expect } from 'vitest';
import { parseMusicXml } from '#frontend/modules/MusicNotation/parseMusicXml.js';
import { initEditor, replacePitch, insertNote, serializeFromEditor } from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote } from './note.js';
import maryXml from '#frontend/modules/MusicNotation/__fixtures__/maryHadALittleLamb.musicxml?raw';

describe('data-loss invariant — edit one note, nothing else changes', () => {
  it('editing one note preserves measure + note counts across save+reload (Mary fixture)', () => {
    const loaded = parseMusicXml(maryXml);
    let ed = initEditor(loaded);
    // edit the first pitched note of measure 0
    const m0 = ed.score.parts[0].measures[0];
    const firstIdx = m0.notes.findIndex((n) => !n.rest && !n.chord);
    ed = replacePitch(ed, { measureIdx: 0, noteIdx: firstIdx }, { step: 'G', octave: 4 });
    const saved = serializeFromEditor(ed);
    const reloaded = parseMusicXml(saved);

    const countNotes = (sc) => sc.parts[0].measures.reduce((a, m) => a + m.notes.length, 0);
    expect(reloaded.parts[0].measures).toHaveLength(loaded.parts[0].measures.length);
    expect(countNotes(reloaded)).toBe(countNotes(loaded));
    // the edited note actually changed
    const editedNote = reloaded.parts[0].measures[0].notes.find((n) => !n.rest && !n.chord);
    expect(editedNote.midi).toBe(67); // G4
  });

  it('preserves ALL rich elements (tie/triplet/dynamics/articulation/lyric) when editing a DIFFERENT note', () => {
    const s = makeEmptyScore();
    const annotated = makeNote({ step: 'E', octave: 4 }, { type: 'eighth', triplet: true, tie: 'start' });
    annotated.dynamics = 'f'; annotated.articulations = ['staccato']; annotated.lyric = 'la';
    const plain = makeNote({ step: 'C', octave: 4 }, { type: 'eighth' });
    s.parts[0].measures[0].notes = [annotated, plain];
    let ed = initEditor(s);
    // edit the PLAIN note's pitch; the annotated note must be untouched through save+reload
    ed = replacePitch(ed, { measureIdx: 0, noteIdx: 1 }, { step: 'D', octave: 4 });
    const reloaded = parseMusicXml(serializeFromEditor(ed));
    const back = reloaded.parts[0].measures[0].notes[0];
    expect(back.tie).toBe('start');
    expect(back.triplet).toBe(true);
    expect(back.dynamics).toBe('f');
    expect(back.articulations).toEqual(['staccato']);
    expect(back.lyric).toBe('la');
  });

  it('preserves annotations that ride through a BARLINE SPLIT (the C1 path) across save+reload', () => {
    // An annotated long note that auto-bar-splits must keep its annotation exactly
    // once (on the tie-start piece), and survive reload.
    const s = makeEmptyScore(); // 4/4 → 96 divisions/bar
    // pre-fill 3.5 beats so the next note overflows and splits
    s.parts[0].measures[0].notes = [
      makeNote({ step: 'C', octave: 4 }, { type: 'half', dots: 1 }), // 3 beats (72 divs)
      makeNote({ step: 'C', octave: 4 }, { type: 'eighth' }),        // 0.5 → 3.5 (84 divs)
    ];
    let ed = initEditor(s);
    // Caret is at {measureIdx:0} after init; insertNote appends at the measure end.
    // A half note (48 divs) with only 12 divs of room overflows and splits across
    // the barline. `lyric` flows opts → makeNote → splitElement's first-piece rich
    // seeding, so it lands on the tie-start piece exactly once.
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'half', lyric: 'la' });
    const reloaded = parseMusicXml(serializeFromEditor(ed));
    // find the D4 pieces across both measures; the FIRST (tie start) must carry the lyric exactly once
    const allNotes = reloaded.parts[0].measures.flatMap((m) => m.notes);
    const d4pieces = allNotes.filter((n) => n.midi === 62);
    const withLyric = d4pieces.filter((n) => n.lyric === 'la');
    expect(withLyric).toHaveLength(1);
    expect(d4pieces.length).toBeGreaterThanOrEqual(2); // it split
  });
});
