import { describe, it, expect } from 'vitest';
import { toTakeEvent, takeDuration, noteOnCount, closeOpenNotes } from './studioRecording.js';

describe('toTakeEvent', () => {
  it('rebases absolute time to a relative offset', () => {
    expect(toTakeEvent({ type: 'note_on', note: 60, velocity: 90, time: 10_500 }, 10_000)).toEqual({
      t: 500, type: 'note_on', note: 60, velocity: 90,
    });
  });
  it('clamps negative offsets to 0 and defaults velocity', () => {
    expect(toTakeEvent({ type: 'note_off', note: 60, time: 9_000 }, 10_000)).toEqual({
      t: 0, type: 'note_off', note: 60, velocity: 0,
    });
  });
});

describe('takeDuration', () => {
  it('is the largest event offset', () => {
    expect(takeDuration([{ t: 0 }, { t: 1200 }, { t: 300 }])).toBe(1200);
  });
  it('is 0 for an empty take', () => {
    expect(takeDuration([])).toBe(0);
  });
});

describe('noteOnCount', () => {
  it('counts only note_on events', () => {
    expect(noteOnCount([
      { type: 'note_on', note: 60 }, { type: 'note_off', note: 60 },
      { type: 'note_on', note: 64 }, { type: 'note_off', note: 64 },
    ])).toBe(2);
  });
  it('is 0 for an empty take', () => {
    expect(noteOnCount([])).toBe(0);
  });
});

describe('closeOpenNotes', () => {
  it('appends note_off for notes still held at stop', () => {
    const events = [
      { t: 0, type: 'note_on', note: 60, velocity: 90 },
      { t: 100, type: 'note_on', note: 64, velocity: 90 },
      { t: 200, type: 'note_off', note: 60, velocity: 0 },
    ];
    const closed = closeOpenNotes(events, 800);
    // 64 was never released → a synthetic note_off at stop time is added.
    expect(closed).toHaveLength(4);
    expect(closed[3]).toEqual({ t: 800, type: 'note_off', note: 64, velocity: 0 });
  });
  it('returns the same events when nothing is held', () => {
    const events = [
      { t: 0, type: 'note_on', note: 60, velocity: 90 },
      { t: 200, type: 'note_off', note: 60, velocity: 0 },
    ];
    expect(closeOpenNotes(events, 800)).toBe(events);
  });
});
