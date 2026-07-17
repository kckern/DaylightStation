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
import { initEditor, replacePitch, insertNote, toggleDot, serializeFromEditor } from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote } from './note.js';
import maryXml from '#frontend/modules/MusicNotation/__fixtures__/maryHadALittleLamb.musicxml?raw';

// Project a Score to a stable, comparable shape (ignore only truly derived/positional noise).
function project(score) {
  return {
    staves: score.parts[0].staves,
    clefs: score.parts[0].clefs,
    key: score.key, timeSig: score.timeSig, tempo: score.tempo,
    measures: score.parts[0].measures.map((m) => ({
      number: m.number,
      notes: m.notes.map((n) => ({
        midi: n.midi ?? null, rest: !!n.rest, type: n.type, dots: n.dots,
        durationQuarters: n.durationQuarters, tie: n.tie ?? null,
        triplet: !!n.triplet, staff: n.staff, voice: n.voice,
        dynamics: n.dynamics ?? null, articulations: n.articulations ?? null, lyric: n.lyric ?? null,
        // Chord flag, absolute onset, and pitch spelling are part of the invariant:
        // without them the gate is blind to a dropped <chord/>, an onset drift from
        // a mis-emitted backup/forward, or an enharmonic respelling on save.
        chord: !!n.chord, onsetQuarter: n.onsetQuarter,
        step: n.pitch?.step ?? null, alter: n.pitch?.alter ?? null,
      })),
    })),
  };
}

// The HONEST data-loss gate: a NORMALIZED DEEP DIFF, not spot-checks. Load Mary,
// apply a REFLOWING command (toggleDot the first treble quarter of measure 0),
// round-trip through the serializer, and assert that EVERY element other than the
// one edited note survives byte-for-byte. This is what proves findings #1 (24×
// duration inflation) and #2 (grand-staff re-bar into 17 measures) are fixed:
// before those fixes this diff explodes; after, exactly one note differs.
describe('data-loss invariant — HONEST normalized deep diff (the P1 gate)', () => {
  it('toggleDot on the first treble note changes ONLY that note (Mary deep-diff)', () => {
    const loaded = parseMusicXml(maryXml);
    let ed = initEditor(loaded);
    const m0 = ed.score.parts[0].measures[0];
    const firstIdx = m0.notes.findIndex((n) => n.staff === 1 && !n.rest && !n.chord);
    ed = toggleDot(ed, { measureIdx: 0, noteIdx: firstIdx });
    const reloaded = parseMusicXml(serializeFromEditor(ed));

    const P = project(loaded);
    const R = project(reloaded);

    // score-level structure is untouched by a single-note edit
    expect(R.staves).toEqual(P.staves);
    expect(R.clefs).toEqual(P.clefs);
    expect(R.key).toEqual(P.key);
    expect(R.timeSig).toEqual(P.timeSig);
    expect(R.tempo).toEqual(P.tempo);

    // measure count unchanged
    expect(R.measures.length).toBe(P.measures.length);

    // total note count unchanged
    const total = (pr) => pr.measures.reduce((a, m) => a + m.notes.length, 0);
    expect(total(R)).toBe(total(P));

    // With onsetQuarter now projected, a REFLOWING dot-toggle produces TWO kinds of
    // legitimate change and NOTHING else: (a) the ONE edited note (gains a dot, 1.0
    // → 1.5 beats, same onset), and (b) the following same-voice notes pushed 0.5
    // beat LATER — a pure onset shift, every other field byte-identical. Neither is
    // data loss: the serialize→reparse round-trip reproduces them faithfully. The
    // gate asserts exactly that partition — one true edit, all other diffs onset-only.
    const flat = (pr) => pr.measures.flatMap((m) => m.notes);
    const pf = flat(P);
    const rf = flat(R);
    expect(rf.length).toBe(pf.length);
    let editDiffs = 0;
    let onsetShiftDiffs = 0;
    for (let i = 0; i < pf.length; i++) {
      const a = pf[i];
      const b = rf[i];
      if (JSON.stringify(a) === JSON.stringify(b)) {
        // durationQuarters of every untouched note is preserved (finding #1 proof)
        expect(b.durationQuarters).toBe(a.durationQuarters);
        continue;
      }
      // Neutralize onset and re-compare: if that makes them equal, the ONLY change
      // was the onset (a reflow shift), not any pitch/duration/annotation corruption.
      const onsetOnly = JSON.stringify({ ...a, onsetQuarter: 0 }) === JSON.stringify({ ...b, onsetQuarter: 0 });
      if (onsetOnly) {
        onsetShiftDiffs += 1;
        expect(b.onsetQuarter).toBeGreaterThan(a.onsetQuarter); // pushed later by the added dot
      } else {
        editDiffs += 1;
        // the ONE genuine edit: the dotted note. Everything but dots+duration intact.
        expect(a.dots).toBe(0);
        expect(b.dots).toBe(1);
        expect(a.durationQuarters).toBe(1);
        expect(b.durationQuarters).toBe(1.5);
        expect(b.midi).toBe(a.midi);
        expect(b.type).toBe(a.type);
        expect(b.lyric).toBe(a.lyric);
        expect(b.staff).toBe(a.staff);
        expect(b.voice).toBe(a.voice);
        expect(b.step).toBe(a.step);
        expect(b.alter).toBe(a.alter);
        expect(b.chord).toBe(a.chord);
        expect(b.onsetQuarter).toBe(a.onsetQuarter); // the edited note starts where it did
      }
    }
    expect(editDiffs).toBe(1); // exactly one real edit
    expect(onsetShiftDiffs).toBeGreaterThanOrEqual(1); // the reflow tail actually moved
  });
});

// The Mary fixture has no chords, so the chord + backup/forward serialization path
// is unexercised by the deep-diff gate above. Build a score WITH a chord and prove
// the SAME invariant: edit one UNRELATED note, and every other element — chord
// flags, absolute onsets, and pitch spelling — survives byte-for-byte.
describe('data-loss invariant — chorded round-trip (the gate is honest about chords)', () => {
  it('edit one melody note; the C-major triad flags, onsets, and spelling all survive', () => {
    const s = makeEmptyScore(); // 4/4, single staff
    // A C-major triad at onset 0 (root + two chord notes on staff 1), then melody.
    s.parts[0].measures[0].notes = [
      makeNote({ step: 'C', octave: 4 }, { type: 'quarter' }),
      makeNote({ step: 'E', octave: 4 }, { type: 'quarter', chord: true }),
      makeNote({ step: 'G', octave: 4 }, { type: 'quarter', chord: true }),
      makeNote({ step: 'D', octave: 4 }, { type: 'quarter' }),
      makeNote({ step: 'F', octave: 4 }, { type: 'quarter' }),
    ];
    const ed0 = initEditor(s);
    // Baseline = the UNEDITED score round-tripped, so both sides are parser output
    // (with onsetQuarter/durationQuarters populated) and directly comparable.
    const before = parseMusicXml(serializeFromEditor(ed0));
    // Edit the D4 melody note (index 3) — UNRELATED to the chord. Pitch edit keeps
    // duration, so no onset should move.
    const edEdited = replacePitch(ed0, { measureIdx: 0, noteIdx: 3 }, { step: 'A', octave: 4 });
    const after = parseMusicXml(serializeFromEditor(edEdited));

    const P = project(before);
    const R = project(after);

    // score-level structure untouched
    expect(R.staves).toEqual(P.staves);
    expect(R.clefs).toEqual(P.clefs);
    expect(R.key).toEqual(P.key);
    expect(R.timeSig).toEqual(P.timeSig);
    expect(R.measures.length).toBe(P.measures.length);

    const flat = (pr) => pr.measures.flatMap((m) => m.notes);
    const pf = flat(P);
    const rf = flat(R);
    expect(rf.length).toBe(pf.length); // 5

    // The two chord notes survive the round-trip as chords at onset 0 (baseline).
    expect(pf[1].chord).toBe(true); expect(pf[1].onsetQuarter).toBe(0);
    expect(pf[2].chord).toBe(true); expect(pf[2].onsetQuarter).toBe(0);

    // Exactly ONE note differs — the edited D4→A4 — everything else byte-identical.
    let diffs = 0;
    for (let i = 0; i < pf.length; i++) {
      if (JSON.stringify(pf[i]) === JSON.stringify(rf[i])) continue;
      diffs += 1;
      expect(i).toBe(3);                // only the edited melody note
      expect(pf[i].midi).toBe(62);      // was D4
      expect(rf[i].midi).toBe(69);      // now A4
      expect(pf[i].step).toBe('D');
      expect(rf[i].step).toBe('A');
      expect(rf[i].onsetQuarter).toBe(pf[i].onsetQuarter); // onset unmoved
      expect(rf[i].chord).toBe(pf[i].chord);               // still not a chord
    }
    expect(diffs).toBe(1);
  });
});

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

  it('preserves grand-staff structure (clefs, staves, per-note staff+voice) across edit+save+reload', () => {
    const loaded = parseMusicXml(maryXml);
    let ed = initEditor(loaded);
    const m0 = ed.score.parts[0].measures[0];
    const idx = m0.notes.findIndex((n) => !n.rest && !n.chord);
    ed = replacePitch(ed, { measureIdx: 0, noteIdx: idx }, { step: 'G', octave: 4 });
    const reloaded = parseMusicXml(serializeFromEditor(ed));

    // staves count preserved
    expect(reloaded.parts[0].staves).toBe(loaded.parts[0].staves); // 2
    // BOTH clefs preserved (treble on staff 1, bass on staff 2)
    expect(reloaded.parts[0].clefs[1]).toEqual(loaded.parts[0].clefs[1]); // {sign:'G',line:2}
    expect(reloaded.parts[0].clefs[2]).toEqual(loaded.parts[0].clefs[2]); // {sign:'F',line:4}
    // per-note staff + voice preserved (multiset compare, order-independent)
    const staffVoice = (sc) => sc.parts[0].measures.flatMap((m) => m.notes.map((n) => `${n.staff}:${n.voice}`)).sort();
    expect(staffVoice(reloaded)).toEqual(staffVoice(loaded));
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
