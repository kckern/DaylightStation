import { describe, it, expect } from 'vitest';
import { newTake, addEvent, noteCount, qualified, silent, takeKey, flushBody } from './autoHistory.js';

// 2026-06-26 10:00:00 local
const START = new Date(2026, 5, 26, 10, 0, 0).getTime();

describe('autoHistory helpers', () => {
  it('newTake derives date + zero-padded HH.MM.SS id from start time', () => {
    const t = newTake(START, 'kc');
    expect(t.owner).toBe('kc');
    expect(t.date).toBe('2026-06-26');
    expect(t.id).toBe('10.00.00');
  });
  it('counts note_on events and qualifies on minNotes + minSeconds', () => {
    let t = newTake(START, 'kc');
    for (let i = 0; i < 4; i++) t = addEvent(t, { type: 'note_on', note: 60 + i, velocity: 80, time: START + i * 100 });
    expect(noteCount(t)).toBe(4);
    expect(qualified(t, { minNotes: 5, minSeconds: 0 })).toBe(false);     // too few notes
    t = addEvent(t, { type: 'note_on', note: 67, velocity: 80, time: START + 4000 });
    expect(qualified(t, { minNotes: 5, minSeconds: 3 })).toBe(true);      // 5 notes, 4s
    expect(qualified(t, { minNotes: 5, minSeconds: 6 })).toBe(false);     // not long enough
  });
  it('silent() is true once silenceMs has passed since the last event', () => {
    let t = newTake(START, 'kc');
    t = addEvent(t, { type: 'note_on', note: 60, velocity: 80, time: START });
    expect(silent(t, START + 24000, 25000)).toBe(false);
    expect(silent(t, START + 25000, 25000)).toBe(true);
  });
  it('takeKey suffixes same-second collisions', () => {
    expect(takeKey('2026-06-26', '10.00.00', new Set())).toBe('10.00.00');
    expect(takeKey('2026-06-26', '10.00.00', new Set(['2026-06-26/10.00.00']))).toBe('10.00.00-2');
  });
  it('flushBody closes still-held notes at the flush time', () => {
    let t = newTake(START, 'kc');
    t = addEvent(t, { type: 'note_on', note: 60, velocity: 80, time: START });
    const body = flushBody(t, START + 1000);
    expect(body.events.at(-1)).toMatchObject({ type: 'note_off', note: 60 });
    expect(body.durationMs).toBeGreaterThanOrEqual(1000);
  });
});
