import { describe, it, expect } from 'vitest';
import {
  initEditor, replacePitch, serializeFromEditor, insertNote,
  insertRest, deleteNote, setDuration, toggleDot, toggleTriplet, toggleTie,
  reflowMeasure, nudgePitch, midiToPitch, moveCaret, select, setAttribute,
} from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote, makeRest, noteDivisions } from './note.js';
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

// --- Unit 8, B21 ------------------------------------------------------------
const sumDivs = (notes) => notes.reduce((s, n) => (n.chord ? s : s + noteDivisions(n)), 0);

describe('insertRest', () => {
  it('inserts a rest that occupies bar space and advances the caret', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertRest(ed, { type: 'quarter' });
    const notes = ed.score.parts[0].measures[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].rest).toBe(true);
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 1 });
  });
  it('overflow splits into separate rests per bar with NO tie chain', () => {
    // 2/4 (cap 48): quarter rest (24) then a whole rest (96) → 24|48|24 rests.
    let ed = initEditor(makeEmptyScore({ time: { beats: 2, beatType: 4 } }));
    ed = insertRest(ed, { type: 'quarter' });
    ed = insertRest(ed, { type: 'whole' });
    const m = ed.score.parts[0].measures;
    const rests = [];
    for (const mm of m) for (const n of mm.notes) rests.push(n);
    expect(rests.every((n) => n.rest === true)).toBe(true);
    // rests never carry a tie field at all
    expect(rests.every((n) => !('tie' in n))).toBe(true);
    expect(m).toHaveLength(3);
    // total placed rest duration equals 24 (fill) + 96 (whole) = 120
    expect(m.reduce((s, mm) => s + sumDivs(mm.notes), 0)).toBe(120);
  });
});

describe('deleteNote', () => {
  it('removes the note at pos and clamps the caret (immutably)', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' });
    const before = ed;
    const after = deleteNote(ed, { measureIdx: 0, noteIdx: 0 });
    expect(after.score.parts[0].measures[0].notes.map((n) => n.midi)).toEqual([62]);
    // immutability: input untouched
    expect(before.score.parts[0].measures[0].notes).toHaveLength(2);
  });
  it('clamps the caret back when it pointed past the new last note', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' }); // caret {0,1}
    const after = deleteNote(ed, { measureIdx: 0, noteIdx: 0 });
    expect(after.score.parts[0].measures[0].notes).toHaveLength(0);
    expect(after.caret).toEqual({ measureIdx: 0, noteIdx: 0 });
  });
});

describe('setDuration', () => {
  it('changes a quarter to a half when the bar has room (simple case)', () => {
    let ed = initEditor(makeEmptyScore()); // 4/4
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = setDuration(ed, { measureIdx: 0, noteIdx: 0 }, { type: 'half' });
    const notes = ed.score.parts[0].measures[0].notes;
    expect(notes[0].type).toBe('half');
    expect(noteDivisions(notes[0])).toBe(48);
  });
  it('lengthening past the barline reflows following content into the next bar with a tie', () => {
    // 4/4: [half(48), quarter C(24), quarter D(24)] fills the bar (96). Lengthen
    // the first note half→whole(96): it now needs the whole bar; the tail C/D
    // spill to bar 1.
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'G', octave: 4 }, { type: 'half' });
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' });
    const before = ed;
    ed = setDuration(ed, { measureIdx: 0, noteIdx: 0 }, { type: 'whole' });
    const m = ed.score.parts[0].measures;
    // whole G4 fills bar 0; C4 and D4 spilled to bar 1
    expect(sumDivs(m[0].notes)).toBe(96);
    expect(m[1].notes.map((n) => n.midi)).toEqual([60, 62]);
    // total duration preserved: 96 + 24 + 24 = 144
    expect(m.reduce((s, mm) => s + sumDivs(mm.notes), 0)).toBe(144);
    // immutability: input's bar 0 still holds the original 3 notes
    expect(before.score.parts[0].measures[0].notes).toHaveLength(3);
    expect(before.score.parts[0].measures[0].notes[0].type).toBe('half');
  });
});

describe('toggleDot / toggleTriplet / toggleTie', () => {
  it('toggleDot flips dots 0↔1 and reflows', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = toggleDot(ed, { measureIdx: 0, noteIdx: 0 });
    expect(ed.score.parts[0].measures[0].notes[0].dots).toBe(1);
    ed = toggleDot(ed, { measureIdx: 0, noteIdx: 0 });
    expect(ed.score.parts[0].measures[0].notes[0].dots).toBe(0);
  });
  it('toggleTriplet flips the triplet flag (and does NOT throw on a non-grid duration)', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'eighth' });
    expect(() => {
      ed = toggleTriplet(ed, { measureIdx: 0, noteIdx: 0 });
    }).not.toThrow();
    expect(ed.score.parts[0].measures[0].notes[0].triplet).toBe(true);
    expect(noteDivisions(ed.score.parts[0].measures[0].notes[0])).toBe(8); // 12 * 2/3
  });
  it('toggleTie sets start then clears', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = toggleTie(ed, { measureIdx: 0, noteIdx: 0 });
    expect(ed.score.parts[0].measures[0].notes[0].tie).toBe('start');
    ed = toggleTie(ed, { measureIdx: 0, noteIdx: 0 });
    expect(ed.score.parts[0].measures[0].notes[0].tie).toBeNull();
  });
});

describe('reflowMeasure — triplet non-multiple-of-6 edge', () => {
  it('a triplet already in the bar does NOT throw when a following note is relengthened', () => {
    // Put a triplet eighth (8 divs) in the bar, then a quarter, then lengthen the
    // quarter to a half. The bar fill (8 + …) is a non-multiple of 6, so reflow
    // must NOT call decomposeDuration on that room — it keeps the note whole.
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'eighth', triplet: true }); // 8 divs
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' }); // 24 → fill 32
    expect(() => {
      ed = setDuration(ed, { measureIdx: 0, noteIdx: 1 }, { type: 'whole' });
    }).not.toThrow();
    // The whole D4 (96) overflows a bar that already has a triplet; per the rule
    // it stays whole in the current measure (bar goes over) rather than throwing.
    const notes = ed.score.parts[0].measures[0].notes;
    expect(notes.some((n) => n.midi === 62 && n.type === 'whole')).toBe(true);
  });
});

// --- Unit 8, B22 ------------------------------------------------------------
describe('midiToPitch', () => {
  it('spells naturals and sharps (C4=60→C4, 61→C#4, down an octave)', () => {
    expect(midiToPitch(60)).toEqual({ step: 'C', octave: 4, alter: 0 });
    expect(midiToPitch(61)).toEqual({ step: 'C', octave: 4, alter: 1 });
    expect(midiToPitch(48)).toEqual({ step: 'C', octave: 3, alter: 0 });
  });
});

describe('nudgePitch', () => {
  function selectedEditor() {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    return select(ed, { measureIdx: 0, noteIdx: 0 });
  }
  it('raises the selected note by a semitone (C4→C#4) immutably', () => {
    const ed0 = selectedEditor();
    const ed1 = nudgePitch(ed0, 1);
    const note = ed1.score.parts[0].measures[0].notes[0];
    expect(note.midi).toBe(61);
    expect(note.pitch).toEqual({ step: 'C', octave: 4, alter: 1 });
    // immutability
    expect(ed0.score.parts[0].measures[0].notes[0].midi).toBe(60);
  });
  it('lowers by an octave with delta -12', () => {
    const ed = nudgePitch(selectedEditor(), -12);
    expect(ed.score.parts[0].measures[0].notes[0].midi).toBe(48);
  });
  it('returns the same state when there is no selection', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(nudgePitch(ed, 1)).toBe(ed);
  });
});

describe('moveCaret / select', () => {
  function threeNoteBars() {
    // bar0: [C, D] ; bar1: [E]
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'quarter' });
    // force a second bar with a note
    ed = { ...ed, caret: { measureIdx: 1, noteIdx: 0 } };
    ed = insertNote(ed, { step: 'E', octave: 4 }, { type: 'quarter' });
    return { ...ed, caret: { measureIdx: 0, noteIdx: 0 } };
  }
  it('left clamps at the very start', () => {
    const ed = threeNoteBars();
    expect(moveCaret(ed, 'left').caret).toEqual({ measureIdx: 0, noteIdx: 0 });
  });
  it('right advances then rolls to the next bar and clamps at the end', () => {
    let ed = threeNoteBars();
    ed = moveCaret(ed, 'right'); // {0,1}
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 1 });
    ed = moveCaret(ed, 'right'); // {0,2} (insertion point after last)
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 2 });
    ed = moveCaret(ed, 'right'); // rolls to {1,0}
    expect(ed.caret).toEqual({ measureIdx: 1, noteIdx: 0 });
    ed = moveCaret(ed, 'right'); // {1,1}
    ed = moveCaret(ed, 'right'); // clamped — last bar, at end
    expect(ed.caret).toEqual({ measureIdx: 1, noteIdx: 1 });
  });
  it('barStart / barEnd jump within the bar', () => {
    let ed = threeNoteBars();
    expect(moveCaret(ed, 'barEnd').caret).toEqual({ measureIdx: 0, noteIdx: 2 });
    ed = { ...ed, caret: { measureIdx: 0, noteIdx: 2 } };
    expect(moveCaret(ed, 'barStart').caret).toEqual({ measureIdx: 0, noteIdx: 0 });
  });
  it('prevBar / nextBar clamp at the ends and never change the score', () => {
    const ed = threeNoteBars();
    expect(moveCaret(ed, 'prevBar').caret.measureIdx).toBe(0); // already first
    const next = moveCaret(ed, 'nextBar');
    expect(next.caret.measureIdx).toBe(1);
    expect(next.score).toBe(ed.score); // caret moves don't touch the score
    expect(moveCaret(next, 'nextBar').caret.measureIdx).toBe(1); // clamp at last
  });
  it('select sets and clears the selection', () => {
    let ed = threeNoteBars();
    ed = select(ed, { measureIdx: 0, noteIdx: 1 });
    expect(ed.selection).toEqual({ measureIdx: 0, noteIdx: 1 });
    expect(select(ed, null).selection).toBeNull();
  });
});

// --- Unit 8, B23 ------------------------------------------------------------
describe('setAttribute', () => {
  it('sets tempo, key, and clef immutably', () => {
    const ed0 = initEditor(makeEmptyScore());
    const ed1 = setAttribute(ed0, 'tempo', 132);
    expect(ed1.score.tempo).toBe(132);
    expect(ed0.score.tempo).toBe(100); // immutability
    const ed2 = setAttribute(ed1, 'key', { fifths: 2, mode: 'major' });
    expect(ed2.score.key).toEqual({ fifths: 2, mode: 'major' });
    const ed3 = setAttribute(ed2, 'clef', { sign: 'F', line: 4 });
    expect(ed3.score.clef).toEqual({ sign: 'F', line: 4 });
  });

  it('time 4/4 → 3/4 re-bars, preserving total duration and respecting the new capacity', () => {
    // 4/4 bar of four quarters (96 divs).
    let ed = initEditor(makeEmptyScore());
    for (const step of ['C', 'D', 'E', 'F']) {
      ed = insertNote(ed, { step, octave: 4 }, { type: 'quarter' });
    }
    const before = ed;
    const totalBefore = ed.score.parts[0].measures.reduce((s, m) => s + sumDivs(m.notes), 0);

    ed = setAttribute(ed, 'time', { beats: 3, beatType: 4 });
    const measures = ed.score.parts[0].measures;
    const cap = 3 * 24; // 72
    // total duration preserved
    const totalAfter = measures.reduce((s, m) => s + sumDivs(m.notes), 0);
    expect(totalAfter).toBe(totalBefore);
    // every bar respects the new capacity
    for (const m of measures) expect(sumDivs(m.notes)).toBeLessThanOrEqual(cap);
    // four quarters re-bar into 3/4 + a leftover quarter → 2 measures
    expect(measures).toHaveLength(2);
    expect(sumDivs(measures[0].notes)).toBe(72);
    expect(sumDivs(measures[1].notes)).toBe(24);
    // immutability: source still 4/4 with one bar
    expect(before.score.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(before.score.parts[0].measures[0].notes).toHaveLength(4);
  });

  it('time re-bar splits a straddling note into a tied chain', () => {
    // 4/4 bar [half, half] (96). Switch to 3/4: second half straddles the 72
    // barline → quarter(72, tie start) + quarter(next bar, tie stop).
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'half' });
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'half' });
    ed = setAttribute(ed, 'time', { beats: 3, beatType: 4 });
    const m = ed.score.parts[0].measures;
    expect(sumDivs(m[0].notes)).toBe(72);
    const last0 = m[0].notes[m[0].notes.length - 1];
    expect(last0.tie).toBe('start');
    expect(m[1].notes[0].tie).toBe('stop');
    // duration preserved: 48 + 48 = 96
    expect(m.reduce((s, mm) => s + sumDivs(mm.notes), 0)).toBe(96);
  });
});
