import { describe, it, expect, beforeEach } from 'vitest';
import { __resetRecorder, record, intern, encodeBatch, buildHeader, KIND } from './inputRecorder.js';
import { decodeEvents, totalDropped } from './decodeEvents.js';

describe('record -> encode -> decode round trip', () => {
  beforeEach(() => __resetRecorder());

  it('reconstructs named events from a scripted session', () => {
    const loopId = intern('loop-toggle');
    record(KIND.MIDI_ON, 72, 88, 112, 0);
    record(KIND.MIDI_OFF, 72, 0, 112, 0);
    record(KIND.UI_INTENT, loopId, 0, 112, 0);
    const header = buildHeader({ session: 's1', score: 'x.mxl', ctx: {} });
    const batch = encodeBatch();

    const events = decodeEvents(header, [batch]);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ event: 'midi.on', note: 72, velocity: 88 });
    expect(events[1]).toMatchObject({ event: 'midi.off', note: 72 });
    expect(events[2]).toMatchObject({ event: 'ui.intent', control: 'loop-toggle' });
    // timestamps preserved & ordered
    expect(events[0].t).toBeLessThanOrEqual(events[1].t);
  });

  it('surfaces dropped counts across batches', () => {
    const h = buildHeader({ session: 's', score: 'x', ctx: {} });
    const decoded = decodeEvents(h, [{ b: [], dropped: 4 }, { b: [], dropped: 1 }]);
    expect(decoded).toEqual([]); // no events, but helper must not throw
    // and a totals helper: drops must be observable in replay
    expect(totalDropped([{ b: [], dropped: 4 }, { b: [], dropped: 1 }])).toBe(5);
  });
});
