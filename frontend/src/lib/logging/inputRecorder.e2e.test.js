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

  it('decodes KEY and EDIT events interned after the header (production order)', () => {
    __resetRecorder();
    const header = buildHeader({ session: 's', score: 'x', ctx: {} });
    record(KIND.KEY, intern('Numpad5'), intern('duration'), 0, 0);
    record(KIND.EDIT, intern('insert-note'), 60, 3, intern('quarter'));
    const events = decodeEvents(header, [encodeBatch()]);
    expect(events[0]).toMatchObject({ event: 'key', code: 'Numpad5', intent: 'duration' });
    expect(events[1]).toMatchObject({ event: 'edit', editType: 'insert-note', note: 60, measure: 3, duration: 'quarter' });
  });

  it('round-trips a realistic Composer session with wall-clock alignment', () => {
    __resetRecorder();
    const header = buildHeader({ session: 's', score: 'draft', ctx: { user: 'u' } });
    // production order: intern names AFTER the header
    record(KIND.KEY, intern('Numpad5'), intern('duration'), 0, 0);
    record(KIND.EDIT, intern('duration'), 0, 0, intern('quarter'));
    record(KIND.MIDI_ON, 60, 88, 0, 0);
    record(KIND.EDIT, intern('insert-note'), 60, 0, intern('quarter'));
    record(KIND.UI_INTENT, intern('undo'), 0, 0, 0);
    record(KIND.EDIT, intern('undo'), 0, 0, 0);
    const batch = encodeBatch();
    const events = decodeEvents(header, [batch]);

    expect(events.map(e => e.event)).toEqual(['key','edit','midi.on','edit','ui.intent','edit']);
    expect(events[0]).toMatchObject({ code: 'Numpad5', intent: 'duration' });
    expect(events[1]).toMatchObject({ editType: 'duration', duration: 'quarter' });
    expect(events[2]).toMatchObject({ note: 60, velocity: 88 });
    expect(events[3]).toMatchObject({ editType: 'insert-note', note: 60, duration: 'quarter' });
    expect(events[5]).toMatchObject({ editType: 'undo' });

    // wall-clock alignment: t0 maps each record's perf-time t to wall-clock
    const { perf, wall } = header.ctx.t0;
    const toWall = (t) => wall + (t - perf);
    const walls = events.map(e => toWall(e.t));
    expect(walls.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < walls.length; i++) expect(walls[i]).toBeGreaterThanOrEqual(walls[i-1]);
  });
});
