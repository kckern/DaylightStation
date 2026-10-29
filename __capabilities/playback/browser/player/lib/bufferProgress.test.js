import { describe, it, expect } from 'vitest';
import {
  readBufferWindow,
  createBufferGrowthTracker,
  decideStuckKind,
  SLOW_LINK_WINDOW_MS,
  SLOW_LINK_MIN_GROWTH_SEC,
  SLOW_LINK_FROZEN_AHEAD_SEC,
  SLOW_LINK_MAX_HOLD_MS,
} from './bufferProgress.js';
import { STALL_JOLT_GRACE_MS } from './stallJolt.js';

const ranges = (...pairs) => ({
  length: pairs.length,
  start: (i) => pairs[i][0],
  end: (i) => pairs[i][1],
});

describe('readBufferWindow', () => {
  it('measures the range that holds the playhead', () => {
    const r = readBufferWindow({ currentTime: 10, buffered: ranges([0, 4], [9, 12.5]), readyState: 2, networkState: 2 });
    expect(r.bufferAheadSec).toBeCloseTo(2.5);
    expect(r.bufferedEndSec).toBeCloseTo(12.5);
    expect(r.readyState).toBe(2);
    expect(r.networkState).toBe(2);
  });

  it('tolerates a playhead a hair before its range (a seek lands just short)', () => {
    const r = readBufferWindow({ currentTime: 8.9, buffered: ranges([9, 11]) });
    expect(r.bufferedEndSec).toBe(11);
    expect(r.bufferAheadSec).toBeCloseTo(2.1);
  });

  it('reads zero ahead with nothing buffered at the playhead', () => {
    const r = readBufferWindow({ currentTime: 50, buffered: ranges([0, 20]) });
    expect(r.bufferAheadSec).toBe(0);
    expect(r.bufferedEndSec).toBe(50);
  });

  it('returns nulls for a missing element or a throwing buffered getter', () => {
    expect(readBufferWindow(null).bufferAheadSec).toBeNull();
    const el = { currentTime: 1, get buffered() { throw new Error('detached'); } };
    expect(readBufferWindow(el).bufferAheadSec).toBeNull();
  });
});

describe('createBufferGrowthTracker', () => {
  it('reports media seconds gained over the window', () => {
    const t = createBufferGrowthTracker();
    t.sample(0, { currentTime: 10, bufferedEndSec: 10.2 });
    t.sample(2000, { currentTime: 10, bufferedEndSec: 10.8 });
    t.sample(4000, { currentTime: 10, bufferedEndSec: 11.4 });
    const g = t.snapshot(4000);
    expect(g.growthSec).toBeCloseTo(1.2);
    expect(g.spanMs).toBe(4000);
    expect(g.ratePerSec).toBeCloseTo(0.3);
    expect(g.lastGrowthAtMs).toBe(4000);
  });

  it('forgets samples older than the window', () => {
    const t = createBufferGrowthTracker({ windowMs: 6000 });
    t.sample(0, { currentTime: 10, bufferedEndSec: 10 });
    t.sample(1000, { currentTime: 10, bufferedEndSec: 15 });
    t.sample(9000, { currentTime: 10, bufferedEndSec: 15 });
    t.sample(10000, { currentTime: 10, bufferedEndSec: 15 });
    expect(t.snapshot(10000).growthSec).toBe(0);
  });

  it('a jump of the playhead (seek, element swap) restarts the baseline, never counts as growth', () => {
    const t = createBufferGrowthTracker();
    t.sample(0, { currentTime: 10, bufferedEndSec: 10.5 });
    t.sample(1000, { currentTime: 300, bufferedEndSec: 300 });
    t.sample(2000, { currentTime: 300, bufferedEndSec: 300 });
    const g = t.snapshot(2000);
    expect(g.growthSec).toBe(0);
    expect(g.lastGrowthAtMs).toBeNull();
  });

  it('a shrinking buffered end (eviction) is not growth', () => {
    const t = createBufferGrowthTracker();
    t.sample(0, { currentTime: 10, bufferedEndSec: 20 });
    t.sample(1000, { currentTime: 10, bufferedEndSec: 18 });
    expect(t.snapshot(1000).growthSec).toBe(0);
  });

  it('ignores unusable readings', () => {
    const t = createBufferGrowthTracker();
    t.sample(0, { currentTime: null, bufferedEndSec: null });
    t.sample(1000, null);
    expect(t.snapshot(1000)).toEqual({ growthSec: 0, spanMs: 0, ratePerSec: null, lastGrowthAtMs: null, samples: 0 });
  });
});

describe('decideStuckKind', () => {
  const base = {
    now: 100_000,
    reading: { bufferAheadSec: 0.2, bufferedEndSec: 10.2, readyState: 2, networkState: 2 },
    growth: { growthSec: 0.9, spanMs: 5000, ratePerSec: 0.18, lastGrowthAtMs: 99_000 },
    hasMediaError: false,
    holdStartedAtMs: null,
  };

  it('a starved playhead whose buffer is still growing is a slow link — wait, do not reload', () => {
    expect(decideStuckKind(base)).toEqual({ kind: 'slow-link', reason: 'buffer-growing' });
  });

  it('a buffer that stopped growing for a full window is stuck', () => {
    const d = decideStuckKind({ ...base, growth: { ...base.growth, growthSec: 0, lastGrowthAtMs: 100_000 - SLOW_LINK_WINDOW_MS - 1 } });
    expect(d).toEqual({ kind: 'stuck', reason: 'no-download-progress' });
  });

  it('growth under the floor (a trickle) is stuck', () => {
    const d = decideStuckKind({ ...base, growth: { ...base.growth, growthSec: SLOW_LINK_MIN_GROWTH_SEC / 2 } });
    expect(d.kind).toBe('stuck');
  });

  it('a media error is always stuck, whatever the buffer does', () => {
    expect(decideStuckKind({ ...base, hasMediaError: true })).toEqual({ kind: 'stuck', reason: 'media-error' });
  });

  it('a frozen clock with plenty buffered is a wedged element, not starvation', () => {
    const d = decideStuckKind({ ...base, reading: { ...base.reading, bufferAheadSec: SLOW_LINK_FROZEN_AHEAD_SEC + 0.5 } });
    expect(d).toEqual({ kind: 'stuck', reason: 'buffered-but-frozen' });
  });

  it('an element that has future data yet stays frozen is wedged, not starved', () => {
    expect(decideStuckKind({ ...base, reading: { ...base.reading, readyState: 3 } })).toEqual({ kind: 'stuck', reason: 'ready-but-frozen' });
    expect(decideStuckKind({ ...base, reading: { ...base.reading, readyState: 4 } }).kind).toBe('stuck');
  });

  it('a slow-link hold is bounded — past the cap the ladder may try one refresh', () => {
    const d = decideStuckKind({ ...base, holdStartedAtMs: base.now - SLOW_LINK_MAX_HOLD_MS - 1 });
    expect(d).toEqual({ kind: 'stuck', reason: 'slow-link-hold-expired' });
  });

  it('before metadata, bytes arriving (progress events) is a slow load, silence is stuck', () => {
    const r0 = { bufferAheadSec: 0, bufferedEndSec: 16, readyState: 0, networkState: 2 };
    expect(decideStuckKind({ ...base, reading: r0, growth: { growthSec: 0, lastGrowthAtMs: null }, networkProgressAtMs: base.now - 800 }))
      .toEqual({ kind: 'slow-link', reason: 'metadata-loading' });
    expect(decideStuckKind({ ...base, reading: r0, growth: null, networkProgressAtMs: base.now - SLOW_LINK_WINDOW_MS - 1 }))
      .toEqual({ kind: 'stuck', reason: 'no-download-progress' });
    expect(decideStuckKind({ ...base, reading: r0, growth: null })).toEqual({ kind: 'stuck', reason: 'no-download-progress' });
    // The backstop bounds a pre-metadata hold too.
    expect(decideStuckKind({ ...base, reading: r0, networkProgressAtMs: base.now, holdStartedAtMs: base.now - SLOW_LINK_MAX_HOLD_MS - 1 }).kind).toBe('stuck');
  });

  it('no reading at all keeps the old behaviour (stuck)', () => {
    expect(decideStuckKind({ ...base, reading: null }).kind).toBe('stuck');
    expect(decideStuckKind({ ...base, growth: null }).kind).toBe('stuck');
  });

  it('thresholds hang together: the window fits inside the jolt grace, the hold is minutes', () => {
    expect(SLOW_LINK_WINDOW_MS).toBeLessThan(STALL_JOLT_GRACE_MS);
    expect(SLOW_LINK_MAX_HOLD_MS).toBeGreaterThanOrEqual(60_000);
  });
});
