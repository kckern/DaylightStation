import { describe, it, expect } from 'vitest';
import { buildComposerTimeline } from './playTimeline.js';
import { makeEmptyScore, makeNote, makeRest, initEditor, insertNote, applyCommand } from './model/index.js';

/** Build a score by driving the real editor commands, then hand back its score. */
function scoreFrom(notes, setup = {}) {
  let state = initEditor(makeEmptyScore(setup));
  for (const [pitch, opts] of notes) state = applyCommand(state, insertNote, pitch, opts);
  return state.score;
}

const C4 = { step: 'C', octave: 4 };
const E4 = { step: 'E', octave: 4 };
const G4 = { step: 'G', octave: 4 };

describe('buildComposerTimeline', () => {
  it('emits a paired note_on/note_off for a quarter at 100bpm, gated to 90%', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }]], { tempo: 100 });
    const tl = buildComposerTimeline(score);
    expect(tl).toEqual([
      { t: 0, type: 'note_on', note: 60, velocity: 80 },
      { t: 540, type: 'note_off', note: 60, velocity: 0 },
    ]);
  });

  it('honors the tempo (200bpm halves every time)', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }], [E4, { type: 'quarter' }]], { tempo: 200 });
    const tl = buildComposerTimeline(score);
    expect(tl.map((e) => e.t)).toEqual([0, 270, 300, 570]);
  });

  it('defaults tempo to 100 when the score carries none', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }]]);
    delete score.tempo;
    expect(buildComposerTimeline(score)[1].t).toBe(540);
  });

  it('scales a dotted half by 1.5 (3 quarters), gated to 90%', () => {
    const score = scoreFrom([[C4, { type: 'half', dots: 1 }]], { tempo: 100 });
    const tl = buildComposerTimeline(score);
    expect(tl[0].t).toBe(0);
    expect(tl[1].t).toBe(Math.round(1800 * 0.9));
  });

  it('spans the whole palette (whole/half/quarter/eighth/16th) in quarter-note ratios', () => {
    const types = [['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 0.5], ['16th', 0.25]];
    for (const [type, quarters] of types) {
      const score = scoreFrom([[C4, { type }]], { tempo: 100 });
      const tl = buildComposerTimeline(score);
      expect(tl[1].t, `${type} should last ${quarters} quarters`).toBe(Math.round(quarters * 600 * 0.9));
    }
  });

  it('gates the note off early so a repeated pitch re-articulates', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }], [C4, { type: 'quarter' }]], { tempo: 100 });
    const tl = buildComposerTimeline(score);
    const off = tl.find((e) => e.type === 'note_off');
    const secondOn = tl.filter((e) => e.type === 'note_on')[1];
    expect(off.t).toBeLessThan(secondOn.t); // the off MUST land before the re-strike
  });

  it('gives chord notes the principal onset and does not advance time for them', () => {
    // Chord notes are flagged `chord: true` and contribute nothing to bar fill
    // (model/editor.js measureFill) — playback must treat them the same way.
    const score = makeEmptyScore({ tempo: 100 });
    score.parts[0].measures[0].notes = [
      makeNote(C4, { type: 'quarter' }),
      makeNote(E4, { type: 'quarter', chord: true }),
      makeNote(G4, { type: 'quarter', chord: true }),
      makeNote(C4, { type: 'quarter', octave: 4 }),
    ];
    const tl = buildComposerTimeline(score);
    const ons = tl.filter((e) => e.type === 'note_on');
    expect(ons.map((e) => e.note)).toEqual([60, 64, 67, 60]);
    expect(ons.map((e) => e.t)).toEqual([0, 0, 0, 600]); // three share an onset; the 4th advances ONCE
  });

  it('advances time for a rest but emits nothing', () => {
    const score = makeEmptyScore({ tempo: 100 });
    score.parts[0].measures[0].notes = [
      makeRest({ type: 'half' }),
      makeNote(C4, { type: 'quarter' }),
    ];
    const tl = buildComposerTimeline(score);
    expect(tl).toHaveLength(2); // the rest is silent
    expect(tl[0]).toMatchObject({ t: 1200, type: 'note_on', note: 60 });
  });

  it('accumulates time across measures', () => {
    // 4/4 at 100bpm: bar = 4 quarters = 2400ms. Five quarters spill into bar 2.
    const score = scoreFrom(Array(5).fill([C4, { type: 'quarter' }]), { tempo: 100 });
    expect(score.parts[0].measures.length).toBeGreaterThan(1);
    const ons = buildComposerTimeline(score).filter((e) => e.type === 'note_on');
    expect(ons.map((e) => e.t)).toEqual([0, 600, 1200, 1800, 2400]);
  });

  it('startAtMeasure drops earlier events and re-zeroes t', () => {
    const score = scoreFrom(Array(6).fill([C4, { type: 'quarter' }]), { tempo: 100 });
    const tl = buildComposerTimeline(score, { startAtMeasure: 1 });
    const ons = tl.filter((e) => e.type === 'note_on');
    expect(ons.map((e) => e.t)).toEqual([0, 600]); // bar 2's two notes, rebased
  });

  it('startAtMeasure drops a straddling note WITH its note_off (never an orphan)', () => {
    const score = scoreFrom(Array(6).fill([C4, { type: 'quarter' }]), { tempo: 100 });
    const tl = buildComposerTimeline(score, { startAtMeasure: 1 });
    expect(tl.filter((e) => e.type === 'note_on')).toHaveLength(tl.filter((e) => e.type === 'note_off').length);
    expect(tl.every((e) => e.t >= 0)).toBe(true);
  });

  it('startAtMeasure past the end yields an empty timeline', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }]], { tempo: 100 });
    expect(buildComposerTimeline(score, { startAtMeasure: 99 })).toEqual([]);
  });

  it('applies the velocity option to every note_on', () => {
    const score = scoreFrom([[C4, { type: 'quarter' }], [E4, { type: 'quarter' }]], { tempo: 100 });
    const tl = buildComposerTimeline(score, { velocity: 42 });
    expect(tl.filter((e) => e.type === 'note_on').every((e) => e.velocity === 42)).toBe(true);
  });

  it('is sorted by t and pairs every note_on with a note_off', () => {
    const score = scoreFrom(
      [[C4, { type: 'eighth' }], [E4, { type: 'half' }], [G4, { type: '16th' }], [C4, { type: 'whole' }]],
      { tempo: 132 },
    );
    const tl = buildComposerTimeline(score);
    for (let i = 1; i < tl.length; i++) expect(tl[i].t).toBeGreaterThanOrEqual(tl[i - 1].t);
    const open = new Map();
    for (const e of tl) {
      if (e.type === 'note_on') open.set(e.note, (open.get(e.note) || 0) + 1);
      else open.set(e.note, (open.get(e.note) || 0) - 1);
      expect(open.get(e.note), 'no note_off may precede its note_on').toBeGreaterThanOrEqual(0);
    }
    expect([...open.values()].every((v) => v === 0)).toBe(true);
  });

  it('runs each part on its own clock so a second part is not appended after the first', () => {
    const score = makeEmptyScore({ tempo: 100 });
    score.parts.push({
      id: 'P2', name: 'Two', staves: 1, clefs: { 1: { sign: 'F', line: 4 } },
      measures: [{ number: 1, notes: [makeNote(G4, { type: 'quarter' })] }],
    });
    score.parts[0].measures[0].notes = [makeNote(C4, { type: 'quarter' })];
    const ons = buildComposerTimeline(score).filter((e) => e.type === 'note_on');
    expect(ons.map((e) => e.t)).toEqual([0, 0]); // simultaneous, not sequential
  });

  it('gives each voice in a bar its own cursor (a grand-staff bar is not one stream)', () => {
    const score = makeEmptyScore({ tempo: 100 });
    score.parts[0].measures[0].notes = [
      makeNote(C4, { type: 'quarter', voice: 1 }),
      makeNote(E4, { type: 'quarter', voice: 1 }),
      makeNote(G4, { type: 'half', voice: 2, staff: 2 }),
    ];
    const ons = buildComposerTimeline(score).filter((e) => e.type === 'note_on');
    // Sorted by t, so voice 2's downbeat half-note sits between voice 1's two
    // quarters — the point being that it starts WITH the first, not after both.
    expect(ons.map((e) => [e.note, e.t])).toEqual([[60, 0], [67, 0], [64, 600]]);
  });

  it('tolerates an empty / absent score without throwing', () => {
    expect(buildComposerTimeline(null)).toEqual([]);
    expect(buildComposerTimeline(makeEmptyScore())).toEqual([]);
    expect(buildComposerTimeline({ parts: [] })).toEqual([]);
  });

  it('skips a note whose type the duration palette cannot express, rather than throwing', () => {
    // A loaded MusicXML can carry a 32nd; noteDivisions throws on it by design.
    // Playback must degrade, not take the whole editor down with it.
    const score = makeEmptyScore({ tempo: 100 });
    score.parts[0].measures[0].notes = [
      { ...makeNote(C4, { type: 'quarter' }), type: '32nd' },
      makeNote(E4, { type: 'quarter' }),
    ];
    const tl = buildComposerTimeline(score);
    expect(tl.filter((e) => e.type === 'note_on').map((e) => e.note)).toEqual([64]);
  });
});
