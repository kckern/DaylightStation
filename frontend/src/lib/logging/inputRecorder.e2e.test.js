import { describe, it, expect, beforeEach } from 'vitest';
import { __resetRecorder, record, intern, encodeBatch, buildHeader, KIND } from './inputRecorder.js';
import { decodeEvents, totalDropped } from './decodeEvents.js';

describe('record -> encode -> decode round trip', () => {
  beforeEach(() => __resetRecorder());

  it('reconstructs named events from a scripted session', () => {
    // Header ships FIRST (production order) — strings are interned AFTER it, so a
    // correct decoder must resolve names from the batch, not just the header.
    const header = buildHeader({ session: 's1', score: 'x.mxl', ctx: {} });
    const loopId = intern('loop-toggle');
    record(KIND.MIDI_ON, 72, 88, 112, 0);
    record(KIND.MIDI_OFF, 72, 0, 112, 0);
    record(KIND.UI_INTENT, loopId, 0, 112, 0);
    const batch = encodeBatch();

    const events = decodeEvents(header, [batch]);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ event: 'midi.on', note: 72, velocity: 88 });
    expect(events[1]).toMatchObject({ event: 'midi.off', note: 72 });
    expect(events[2]).toMatchObject({ event: 'ui.intent', control: 'loop-toggle' });
    // timestamps preserved & ordered
    expect(events[0].t).toBeLessThanOrEqual(events[1].t);
  });

  it('resolves names interned AFTER the header (production order)', () => {
    __resetRecorder();
    const header = buildHeader({ session: 's', score: 'x', ctx: {} }); // header FIRST, strings still empty
    const id = intern('mode');            // interned AFTER header — the real order
    record(KIND.UI_INTENT, id, 0, 42, 0);
    const batch = encodeBatch();
    const events = decodeEvents(header, [batch]);
    expect(events[0]).toMatchObject({ event: 'ui.intent', control: 'mode' }); // FAILS today (control: undefined)
  });

  it('preserves touch-sample timestamps in the polyline (sampleT from slot c)', () => {
    const header = buildHeader({ session: 's', score: 'x', ctx: {} });
    // Two moves replayed together at pointerup (record-time t near-identical) but
    // whose ORIGINAL sample times are 100ms apart, carried in slot c.
    const batch = { b: [
      [5000.0, KIND.TOUCH_MOVE, 10, 20, 100, 0],
      [5000.1, KIND.TOUCH_MOVE, 30, 40, 200, 0],
    ], dropped: 0 };
    const events = decodeEvents(header, [batch]);
    expect(events[0]).toMatchObject({ event: 'touch.move', x: 10, y: 20, sampleT: 100 });
    expect(events[1].sampleT - events[0].sampleT).toBe(100); // ~100ms apart on the real time axis
    expect(Math.abs(events[1].t - events[0].t)).toBeLessThan(1); // record-time t nearly identical
  });

  it('surfaces dropped counts across batches', () => {
    const h = buildHeader({ session: 's', score: 'x', ctx: {} });
    const decoded = decodeEvents(h, [{ b: [], dropped: 4 }, { b: [], dropped: 1 }]);
    expect(decoded).toEqual([]); // no events, but helper must not throw
    // and a totals helper: drops must be observable in replay
    expect(totalDropped([{ b: [], dropped: 4 }, { b: [], dropped: 1 }])).toBe(5);
  });
});
