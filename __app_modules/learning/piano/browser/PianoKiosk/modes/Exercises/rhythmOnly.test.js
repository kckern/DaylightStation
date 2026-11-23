import { describe, expect, it } from 'vitest';
import { RHYTHM_MIDI, rhythmNotes, toRhythmExpectation } from './rhythmOnly.js';

describe('toRhythmExpectation', () => {
  const expectation = { version: 1, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], measureMap: [], events: [
    { id: 'e1', onsetQuarter: 0, durationQuarters: 1, spanId: 'measure:0', notes: [{ id: 'n1', midi: 64, part: 'rh' }, { id: 'n2', midi: 48, part: 'lh' }] },
    { id: 'e2', onsetQuarter: 1, durationQuarters: 1, spanId: 'measure:0', notes: [{ id: 'n3', midi: 67, part: 'rh' }] },
    { id: 'e3', onsetQuarter: 2, durationQuarters: 1, spanId: 'measure:0', notes: [] },
  ] };
  it('reduces every event to one note on one pitch and keeps the timing', () => {
    const out = toRhythmExpectation(expectation);
    expect(out.events.map((event) => [event.id, event.onsetQuarter, event.notes.map((note) => note.midi)])).toEqual([['e1', 0, [RHYTHM_MIDI]], ['e2', 1, [RHYTHM_MIDI]], ['e3', 2, []]]);
    expect(out.tempoMap).toBe(expectation.tempoMap);
    expect(out.events[0].notes[0].id).toBe('n1:rhythm');
  });
  it('does not touch the original', () => {
    toRhythmExpectation(expectation);
    expect(expectation.events[0].notes).toHaveLength(2);
  });
  it('passes through what it cannot read', () => {
    expect(toRhythmExpectation(null)).toBeNull();
  });
});

describe('rhythmNotes', () => {
  it('reads any key, or several together, as one tap stamped at the first press', () => {
    const held = new Map([[72, { velocity: 80, timestamp: 1200 }], [40, { velocity: 60, timestamp: 1100 }]]);
    expect([...rhythmNotes(held)]).toEqual([[RHYTHM_MIDI, { velocity: 60, timestamp: 1100 }]]);
  });
  it('is empty when nothing is held', () => {
    expect(rhythmNotes(new Map()).size).toBe(0);
  });
});
