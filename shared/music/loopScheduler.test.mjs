import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loopToEvents, loopLengthTicks, buildLoopCycle } from './loopScheduler.mjs';

describe('loopToEvents', () => {
  const notes = [{ ticks: 0, durationTicks: 480, midi: 60 }];

  it('emits note_on/note_off at tempo-derived ms (120bpm, 480ppq → 1 beat = 500ms)', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 120 });
    assert.deepEqual(ev, [
      { t: 0, type: 'note_on', note: 60, velocity: 90, channel: 0 },
      { t: 500, type: 'note_off', note: 60, velocity: 0, channel: 0 },
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

  it('stamps every event with the channel option (default 0)', () => {
    const def = loopToEvents(notes, { ppq: 480, bpm: 120 });
    assert.ok(def.every((e) => e.channel === 0));
    const ch5 = loopToEvents(notes, { ppq: 480, bpm: 120, channel: 5 });
    assert.ok(ch5.every((e) => e.channel === 5));
    assert.equal(ch5.find((e) => e.type === 'note_off').channel, 5);
  });

  it('clamps/floors invalid channel values into 0..15 without throwing', () => {
    assert.equal(loopToEvents(notes, { ppq: 480, bpm: 120, channel: -1 })[0].channel, 0);
    assert.equal(loopToEvents(notes, { ppq: 480, bpm: 120, channel: 16.7 })[0].channel, 15);
    assert.equal(loopToEvents(notes, { ppq: 480, bpm: 120, channel: 3.9 })[0].channel, 3);
    assert.equal(loopToEvents(notes, { ppq: 480, bpm: 120, channel: 'x' })[0].channel, 0);
    assert.equal(loopToEvents(notes, { ppq: 480, bpm: 120, channel: NaN })[0].channel, 0);
  });

  it('scales note_on velocity by gain, clamped to 1..127', () => {
    const half = loopToEvents(notes, { ppq: 480, bpm: 120, gain: 0.5 });
    assert.equal(half.find((e) => e.type === 'note_on').velocity, 45);
    // floor clamp: 90 * 0.01 = 0.9 → rounds to 1, never 0 (0 would read as note_off)
    const tiny = loopToEvents(notes, { ppq: 480, bpm: 120, gain: 0.01 });
    assert.equal(tiny.find((e) => e.type === 'note_on').velocity, 1);
    // gain is capped at 1 (no boost in v1) so velocity never exceeds the base…
    const boost = loopToEvents(notes, { ppq: 480, bpm: 120, gain: 5 });
    assert.equal(boost.find((e) => e.type === 'note_on').velocity, 90);
    // …and the 127 ceiling holds even for out-of-range base velocities
    const loud = loopToEvents(notes, { ppq: 480, bpm: 120, velocity: 200, gain: 1 });
    assert.equal(loud.find((e) => e.type === 'note_on').velocity, 127);
  });

  it('leaves note_off velocity at 0 regardless of gain', () => {
    const ev = loopToEvents(notes, { ppq: 480, bpm: 120, gain: 0.5 });
    assert.equal(ev.find((e) => e.type === 'note_off').velocity, 0);
  });

  it('emits nothing at gain ≤ 0 (silent layer: no on OR off events)', () => {
    assert.deepEqual(loopToEvents(notes, { ppq: 480, bpm: 120, gain: 0 }), []);
    assert.deepEqual(loopToEvents(notes, { ppq: 480, bpm: 120, gain: -0.5 }), []);
  });

  it('treats non-numeric gain (null, string, NaN) as 1, not silence', () => {
    for (const gain of [null, 'x', NaN]) {
      const ev = loopToEvents(notes, { ppq: 480, bpm: 120, gain });
      assert.equal(ev.find((e) => e.type === 'note_on').velocity, 90, `gain=${String(gain)}`);
    }
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

  it('passes per-layer channel through to the merged events (default 0)', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, transpose: 0, channel: 2 },
      { notes: oneBar, ppq: 480, transpose: 7, channel: 9 },
      { notes: oneBar, ppq: 480, transpose: 12 },
    ], { bpm: 120 });
    const chFor = (note) => cycle.events.find((e) => e.type === 'note_on' && e.note === note).channel;
    assert.equal(chFor(60), 2);
    assert.equal(chFor(67), 9);
    assert.equal(chFor(72), 0);
    // note_offs carry the layer channel too
    const offFor = (note) => cycle.events.find((e) => e.type === 'note_off' && e.note === note).channel;
    assert.equal(offFor(67), 9);
  });

  it('applies per-layer gain to velocities', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, transpose: 0, gain: 0.5 },
      { notes: oneBar, ppq: 480, transpose: 7 },
    ], { bpm: 120 });
    const velFor = (note) => cycle.events.find((e) => e.type === 'note_on' && e.note === note).velocity;
    assert.equal(velFor(60), 45);
    assert.equal(velFor(67), 90); // default gain 1
  });

  it('silences a gain-0 layer but keeps its bar span in the cycle length', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, barSpan: 1 },
      { notes: oneBar, ppq: 480, transpose: 7, barSpan: 4, gain: 0 }, // silent, but longest layer
    ], { bpm: 120 });
    assert.ok(!cycle.events.some((e) => e.note === 67)); // no events from the silent layer
    assert.equal(cycle.lengthMs, 8000); // 4 bars @120bpm — silent layer still anchors phase
    // audible layer tiles across the silent layer's span
    const ons = cycle.events.filter((e) => e.type === 'note_on' && e.note === 60).map((e) => e.t);
    assert.deepEqual(ons, [0, 2000, 4000, 6000]);
  });

  it('muted flag and gain 0 both silence, and they compose', () => {
    const cycle = buildLoopCycle([
      { notes: oneBar, ppq: 480, transpose: 0 },
      { notes: oneBar, ppq: 480, transpose: 7, gain: 0 },
      { notes: oneBar, ppq: 480, transpose: 12, muted: true },
      { notes: oneBar, ppq: 480, transpose: 5, muted: true, gain: 0 },
    ], { bpm: 120 });
    const notes60 = cycle.events.map((e) => e.note);
    assert.ok(notes60.includes(60));
    assert.ok(!notes60.includes(67));
    assert.ok(!notes60.includes(72));
    assert.ok(!notes60.includes(65));
  });
});

describe('buildLoopCycle harmonic alignment', () => {
  const oneNotePerBar = (bars) => Array.from({ length: bars }, (_, b) => ({ ticks: b * 480 * 4, durationTicks: 480, midi: 60 }));

  it('sizes the master cycle by barSpan (bars), not raw note length', () => {
    const layers = [
      { notes: oneNotePerBar(3), ppq: 480, barSpan: 3 },
      { notes: oneNotePerBar(6), ppq: 480, barSpan: 6 },
    ];
    const { lengthMs } = buildLoopCycle(layers, { bpm: 120 });
    assert.equal(Math.round(lengthMs), 12000);
  });

  it('tiles the 3-bar layer twice to fill the 6-bar cycle (aligned)', () => {
    const layers = [
      { notes: oneNotePerBar(3), ppq: 480, barSpan: 3 },
      { notes: oneNotePerBar(6), ppq: 480, barSpan: 6 },
    ];
    const { events } = buildLoopCycle(layers, { bpm: 120 });
    const ons = events.filter((e) => e.type === 'note_on').length;
    assert.equal(ons, 6 + 6);
  });
});
