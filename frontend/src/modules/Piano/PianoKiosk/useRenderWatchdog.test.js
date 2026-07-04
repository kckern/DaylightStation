import { describe, it, expect } from 'vitest';
import { tickWatchdog, buildBeat, DEFAULT_BEAT_URL } from './useRenderWatchdog.js';

const OPTS = { minFps: 12, sustainSeconds: 4 };
const fresh = { jankSeconds: 0, fired: false };

describe('tickWatchdog', () => {
  it('does not fire while fps is healthy', () => {
    const s = tickWatchdog(fresh, 60, OPTS);
    expect(s.jankSeconds).toBe(0);
    expect(s.shouldFire).toBe(false);
  });

  it('fires exactly once after sustainSeconds consecutive janky samples', () => {
    let s = fresh;
    const fires = [];
    for (let i = 0; i < 6; i++) { s = tickWatchdog(s, 5, OPTS); fires.push(s.shouldFire); }
    // below threshold each second: fire on the 4th consecutive janky second, then latch
    expect(fires).toEqual([false, false, false, true, false, false]);
  });

  it('resets the jank counter when a healthy frame arrives', () => {
    let s = fresh;
    s = tickWatchdog(s, 5, OPTS); // 1 janky
    s = tickWatchdog(s, 5, OPTS); // 2 janky
    s = tickWatchdog(s, 60, OPTS); // healthy → reset
    expect(s.jankSeconds).toBe(0);
    s = tickWatchdog(s, 5, OPTS); // 1 janky again
    expect(s.shouldFire).toBe(false);
  });

  it('latches after firing so it never thrashes (no second fire before reload)', () => {
    let s = fresh;
    for (let i = 0; i < 4; i++) s = tickWatchdog(s, 1, OPTS);
    expect(s.fired).toBe(true);
    const after = tickWatchdog(s, 1, OPTS);
    expect(after.shouldFire).toBe(false);
    expect(after.fired).toBe(true);
  });
});

describe('buildBeat', () => {
  it('rounds fps and carries liveness fields for the bridge', () => {
    const beat = buildBeat(58.6, {
      visibility: 'visible', url: 'https://x/piano', sinceLoadMs: 12345.9, ts: 1720033000000,
    });
    expect(beat).toEqual({
      fps: 59, visibility: 'visible', url: 'https://x/piano', sinceLoadMs: 12346, ts: 1720033000000,
    });
  });

  it('degrades missing fields to safe defaults (never emits NaN/undefined)', () => {
    const beat = buildBeat(0, {});
    expect(beat).toEqual({ fps: 0, visibility: 'unknown', url: '', sinceLoadMs: 0, ts: 0 });
    expect(Number.isNaN(beat.sinceLoadMs)).toBe(false);
  });

  it('exposes the localhost bridge ingest as the default target', () => {
    expect(DEFAULT_BEAT_URL).toBe('http://localhost:8770/kiosk/beat');
  });
});
