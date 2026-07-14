import { describe, it, expect } from 'vitest';
import { resolveSheetMusicConfig } from './sheetMusicConfig.js';

describe('resolveSheetMusicConfig', () => {
  it('applies defaults when unset', () => {
    expect(resolveSheetMusicConfig(undefined)).toEqual({
      defaultMode: 'listen',
      perform: { advancePedalCC: 67, backPedalCC: 66 },
      scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
    });
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
});
