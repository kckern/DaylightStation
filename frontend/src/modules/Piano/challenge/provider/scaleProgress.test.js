import { describe, expect, it } from 'vitest';
import { advanceScaleProgress } from './scaleProgress.js';

describe('advanceScaleProgress', () => {
  const scale = [60, 62, 64];

  it('completes only in order', () => {
    let progress = 0;
    for (const note of scale) progress = advanceScaleProgress(scale, progress, note).progress;
    expect(progress).toBe(scale.length);
    expect(advanceScaleProgress(scale, 2, 64).complete).toBe(true);
  });

  it('resets on a wrong note and lets the first note restart immediately', () => {
    expect(advanceScaleProgress(scale, 2, 65)).toEqual({ progress: 0, wrong: true, complete: false });
    expect(advanceScaleProgress(scale, 2, 60)).toEqual({ progress: 1, wrong: true, complete: false });
  });
});
