import { describe, it, expect } from 'vitest';
import { resolveSheetMusicConfig } from './sheetMusicConfig.js';

describe('resolveSheetMusicConfig', () => {
  it('applies defaults when unset', () => {
    const resolved = resolveSheetMusicConfig(undefined);
    expect(resolved).toMatchObject({
      defaultMode: 'listen',
      perform: { advancePedalCC: 67, backPedalCC: 66 },
      scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
      learn: {
        defaultHands: 'both',
        passages: { targetMeasures: 4, minMeasures: 3, maxMeasures: 5 },
      },
    });
    expect(resolved.learn.ladder.map(({ id, mode, sets, reps, availability, consecutive, completes }) => (
      { id, mode, sets, reps, availability, consecutive, completes }
    ))).toEqual([
      { id: 'right', mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, completes: 'rung' },
      { id: 'left', mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, completes: 'rung' },
      { id: 'together', mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, completes: 'rung' },
      { id: 'timed', mode: 'cued', sets: 1, reps: 3, availability: 'sequential', consecutive: false, completes: 'passage' },
      { id: 'test-out', mode: 'cued', sets: 1, reps: 3, availability: 'always', consecutive: true, completes: 'passage' },
    ]);
    expect(resolved.learn.revision).toMatch(/^[a-f0-9]{64}$/);
  });
  it('merges partial overrides', () => {
    const c = resolveSheetMusicConfig({ perform: { advancePedalCC: 64 }, scoring: { thresholds: { green: 0.95 } } });
    expect(c.perform).toEqual({ advancePedalCC: 64, backPedalCC: 66 });
    expect(c.scoring.thresholds).toEqual({ green: 0.95, yellow: 0.6 });
    expect(c.scoring.silentMeasuresToStop).toBe(4);
  });
  it('ignores null/garbage and returns full defaults', () => {
    expect(resolveSheetMusicConfig(null).defaultMode).toBe('listen');
    expect(resolveSheetMusicConfig('nope').perform.backPedalCC).toBe(66);
  });
  it('resolves the Learn hand preference default and override (wave-3 E)', () => {
    expect(resolveSheetMusicConfig({}).learn.defaultHands).toBe('both');
    expect(resolveSheetMusicConfig({ learn: { defaultHands: 'rh' } }).learn.defaultHands).toBe('rh');
  });

  it('atomically accepts a valid ladder and merges passage sizing', () => {
    const ladder = [{
      id: 'play', label: 'Play it', parts: ['rh'], mode: 'free', sets: 1, reps: 2,
      availability: 'always', criteria: { completeness: 1 }, completes: 'passage',
    }];
    const c = resolveSheetMusicConfig({ learn: { passages: { maxMeasures: 6 }, ladder } });
    expect(c.learn.passages).toEqual({ targetMeasures: 4, minMeasures: 3, maxMeasures: 6 });
    expect(c.learn.ladder).toHaveLength(1);
    expect(c.learn.ladder[0]).toMatchObject({ id: 'play', reps: 2, consecutive: false });
  });

  it('falls back to the complete default ladder when any override rung is malformed', () => {
    const c = resolveSheetMusicConfig({ learn: { ladder: [
      { id: 'valid', label: 'Valid', parts: ['rh'], mode: 'free', sets: 1, reps: 1 },
      { id: 'broken', label: 'Broken', parts: ['rh'], mode: 'warp', sets: 1, reps: 1 },
    ] } });
    expect(c.learn.ladder.map((rung) => rung.id)).toEqual(['right', 'left', 'together', 'timed', 'test-out']);
  });

  it.each([
    [],
    [
      { id: 'same', label: 'One', parts: ['rh'], mode: 'free', sets: 1, reps: 1 },
      { id: ' same ', label: 'Two', parts: ['lh'], mode: 'free', sets: 1, reps: 1 },
    ],
  ])('rejects an empty or duplicate-id ladder override atomically', (ladder) => {
    const c = resolveSheetMusicConfig({ learn: { ladder } });
    expect(c.learn.configFallback).toBe(true);
    expect(c.learn.ladder.map((rung) => rung.id)).toEqual(['right', 'left', 'together', 'timed', 'test-out']);
  });
});
