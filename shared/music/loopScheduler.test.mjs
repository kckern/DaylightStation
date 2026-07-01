import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loopToEvents, loopLengthTicks, buildLoopCycle } from './loopScheduler.mjs';

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

describe('buildLoopCycle', () => {
  const oneBar = [{ ticks: 0, durationTicks: 480, midi: 60 }]; // 1 note, rounds to 1 bar

  it('merges layers into one looped timeline with a master length in ms', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, transpose: 0 },
      { notes: oneBar, ppq: 480, transpose: 7 },
    ], { bpm: 120 });
    assert.equal(cycle.lengthMs, 2000); // 1 bar @120bpm = 2000ms
    // both layers contribute a note_on at t=0 (one at 60, one at 67)
    const onsAtZero = cycle.events.filter((e) => e.type === 'note_on' && e.t === 0).map((e) => e.note).sort((a, b) => a - b);
    assert.deepEqual(onsAtZero, [60, 67]);
  });

  it('excludes muted layers', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, transpose: 0 },
      { notes: oneBar, ppq: 480, transpose: 7, muted: true },
    ], { bpm: 120 });
    assert.ok(!cycle.events.some((e) => e.note === 67));
  });

  it('tiles a shorter layer to fill the master cycle', () => {
    const halfBar = [{ ticks: 0, durationTicks: 240, midi: 60 }]; // still rounds to 1 bar on its own...
    // make a genuinely 2-bar layer to force tiling of the 1-bar layer
    const twoBar = [{ ticks: 1920, durationTicks: 480, midi: 72 }]; // note in bar 2 → 2 bars
    const cycle = buildLoopCycle([
      { notes: twoBar, ppq: 480, transpose: 0 },   // master = 2 bars = 4000ms
      { notes: oneBar, ppq: 480, transpose: 0 },   // 1 bar → tiled x2
    ], { bpm: 120 });
    assert.equal(cycle.lengthMs, 4000);
    const oneBarOns = cycle.events.filter((e) => e.type === 'note_on' && e.note === 60).map((e) => e.t);
    assert.deepEqual(oneBarOns, [0, 2000]); // tiled at start of each bar
  });

  it('returns an empty cycle with a default length for no layers', () => {
    const cycle = buildLoopCycle([], { bpm: 120 });
    assert.deepEqual(cycle.events, []);
    assert.ok(cycle.lengthMs > 0);
  });
});
