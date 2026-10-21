import { describe, it, expect } from 'vitest';
import { FitnessProgressClassifier } from './FitnessProgressClassifier.mjs';

const classifier = new FitnessProgressClassifier();

describe('FitnessProgressClassifier', () => {
  it('counts a short workout watched at 50% (skipped cooldown)', () => {
    expect(classifier.classify({ playhead: 1530, percent: 85, watchTime: 1500 }, { duration: 1800 })).toBe('watched');
  });

  it('keeps a 2-hour longplay at 60% in progress', () => {
    expect(classifier.classify({ playhead: 4320, percent: 60, watchTime: 4000 }, { duration: 7200 })).toBe('in_progress');
  });

  it('counts a 60-minute workout watched at 95% (3 minutes left)', () => {
    expect(classifier.classify({ playhead: 3420, percent: 95, watchTime: 3400 }, { duration: 3600 })).toBe('watched');
  });

  // 2026-10-20: Sonic & Sega All Stars Racing, 4h51m, stopped at 94%
  it('keeps a racing longplay in progress past 95% while a cup is still left', () => {
    expect(classifier.classify({ playhead: 16768, percent: 96, watchTime: 19000 }, { duration: 17467 })).toBe('in_progress');
  });

  it('counts the longplay watched once 5 minutes or less remain', () => {
    expect(classifier.classify({ playhead: 17200, percent: 98, watchTime: 19500 }, { duration: 17467 })).toBe('watched');
  });

  it('lets config widen the remaining-time allowance', () => {
    const loose = new FitnessProgressClassifier({ longMaxRemainingSeconds: 15 * 60 });
    expect(loose.classify({ playhead: 16768, percent: 96, watchTime: 19000 }, { duration: 17467 })).toBe('watched');
  });

  it('keeps a seek-only preview in progress', () => {
    expect(classifier.classify({ playhead: 1620, percent: 90, watchTime: 10 }, { duration: 1800 })).toBe('in_progress');
  });
});
