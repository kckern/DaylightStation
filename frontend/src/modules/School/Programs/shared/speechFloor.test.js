import { describe, expect, it } from 'vitest';
import { MIN_TAKE_MS, SILENT_AFTER_MS, SILENT_LEVEL, judgeTake } from './speechFloor.js';

describe('speech floor', () => {
  it('keeps the measured thresholds', () => {
    expect([SILENT_LEVEL, SILENT_AFTER_MS, MIN_TAKE_MS]).toEqual([0.04, 2000, 1200]);
  });
  it('refuses a measured take that was never heard', () => {
    expect(judgeTake({ heard: false, sampled: true, durationMs: 3000 })).toBe('too-quiet');
  });
  it('never refuses on loudness it could not measure', () => {
    expect(judgeTake({ heard: false, sampled: false, durationMs: 3000 })).toBeNull();
  });
  it('refuses a take shorter than the floor', () => {
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1199 })).toBe('too-short');
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1200 })).toBeNull();
  });
});

describe('voice meter', () => {
  it('splits a take into voiced and silent time from the live levels, and keeps the trailing silence', async () => {
    const { createVoiceMeter, meterLevel, meterSummary } = await import('./speechFloor.js');
    const m = createVoiceMeter(1000);
    meterLevel(m, 0.01, 1000);   // first sample: no interval yet
    meterLevel(m, 0.01, 1500);   // +500 silent
    meterLevel(m, 0.2, 1700);    // +200 voiced
    meterLevel(m, 0.3, 2000);    // +300 voiced
    meterLevel(m, 0.0, 2400);    // +400 silent (trailing)
    meterLevel(m, 0.0, 2600);    // +200 silent (trailing)
    expect(meterSummary(m)).toEqual({ voicedMs: 500, silentMs: 1100, endSilentMs: 600 });
    expect(m.heard).toBe(true);
    expect(m.sampled).toBe(true);
  });

  it('reports null, not zero, when no level ever arrived — the device could not measure it', async () => {
    const { createVoiceMeter, meterSummary } = await import('./speechFloor.js');
    expect(meterSummary(createVoiceMeter(0))).toEqual({ voicedMs: null, silentMs: null, endSilentMs: null });
  });

  it('turns the silent warning on after SILENT_AFTER_MS unheard, and says so exactly once', async () => {
    const { createVoiceMeter, meterLevel } = await import('./speechFloor.js');
    const m = createVoiceMeter(0);
    expect(meterLevel(m, 0, 0)).toBeNull();
    expect(meterLevel(m, 0, 1999)).toBeNull();
    expect(meterLevel(m, 0, 2000)).toBe('silent-on');
    expect(m.silent).toBe(true);
    expect(meterLevel(m, 0, 2500)).toBeNull();
    expect(meterLevel(m, 0.5, 2600)).toBe('silent-off');
    expect(m.silent).toBe(false);
    // Heard once, never called silent again — the rung's rule, unchanged.
    // (A long silence after speech is an auto-stop instead; see below.)
    expect(meterLevel(m, 0, 9000)).not.toBe('silent-on');
    expect(m.silent).toBe(false);
  });

  it('a level over the floor with no warning showing is not a transition', async () => {
    const { createVoiceMeter, meterLevel } = await import('./speechFloor.js');
    const m = createVoiceMeter(0);
    expect(meterLevel(m, 0.5, 10)).toBeNull();
  });
});

describe('auto-stop on silence after speech', () => {
  it('fires once, after AUTO_STOP_SILENT_MS of silence that follows speech', async () => {
    const { createVoiceMeter, meterLevel, AUTO_STOP_SILENT_MS } = await import('./speechFloor.js');
    expect(AUTO_STOP_SILENT_MS).toBe(3000);
    const m = createVoiceMeter(0);
    meterLevel(m, 0.3, 0);
    meterLevel(m, 0.3, 500);
    expect(meterLevel(m, 0, 3400)).toBeNull();      // 2900ms silent
    expect(meterLevel(m, 0, 3500)).toBe('auto-stop'); // 3000ms
    expect(meterLevel(m, 0, 4000)).toBeNull();      // once
  });
  it('never fires on leading silence, however long', async () => {
    const { createVoiceMeter, meterLevel } = await import('./speechFloor.js');
    const m = createVoiceMeter(0);
    const seen = [];
    for (let t = 0; t <= 20000; t += 100) seen.push(meterLevel(m, 0, t));
    expect(seen).not.toContain('auto-stop');
  });
});
