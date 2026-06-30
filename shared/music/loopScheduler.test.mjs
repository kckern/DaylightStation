import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loopToEvents, loopLengthTicks } from './loopScheduler.mjs';

describe('loopToEvents', () => {
  const notes = [{ ticks: 0, durationTicks: 480, midi: 60 }];

  it('emits note_on/note_off at tempo-derived ms (120bpm, 480ppq → 1 beat = 500ms)', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 120 });
    assert.deepEqual(ev, [
      { t: 0, type: 'note_on', note: 60, velocity: 90 },
      { t: 500, type: 'note_off', note: 60, velocity: 0 },
    ]);
  });

  it('applies transpose to the emitted note numbers', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 120, transpose: 2 });
    assert.equal(ev[0].note, 62);
    assert.equal(ev[1].note, 62);
  });

  it('offsets every event by cycleStartMs (for looped re-scheduling)', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 120, cycleStartMs: 1000 });
    assert.equal(ev[0].t, 1000);
    assert.equal(ev[1].t, 1500);
  });

  it('halves timing at double tempo', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 240 });
    assert.equal(ev[1].t, 250);
  });

  it('sorts events by time', () => {
    const two = [
      { ticks: 480, durationTicks: 240, midi: 64 },
      { ticks: 0, durationTicks: 240, midi: 60 },
    ];
    const ts = loopToEvents(two, { ppq: 480, bpm: 120 }).map((e) => e.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  });
});

describe('loopLengthTicks', () => {
  it('rounds the loop up to whole bars (4/4)', () => {
    assert.equal(loopLengthTicks([{ ticks: 0, durationTicks: 480 }], 480, { beats: 4, beatType: 4 }), 1920);
    assert.equal(loopLengthTicks([{ ticks: 0, durationTicks: 1920 }], 480, { beats: 4, beatType: 4 }), 1920);
    assert.equal(loopLengthTicks([{ ticks: 1920, durationTicks: 480 }], 480, { beats: 4, beatType: 4 }), 3840);
  });
  it('handles 3/4 bars', () => {
    assert.equal(loopLengthTicks([{ ticks: 0, durationTicks: 480 }], 480, { beats: 3, beatType: 4 }), 1440);
  });
  it('returns one bar for an empty loop', () => {
    assert.equal(loopLengthTicks([], 480, { beats: 4, beatType: 4 }), 1920);
  });
});
