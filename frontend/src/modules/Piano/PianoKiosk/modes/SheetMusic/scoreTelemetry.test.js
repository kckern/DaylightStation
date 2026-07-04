import { describe, it, expect } from 'vitest';
import { summarizeDrift, classifyFollowHit } from './scoreTelemetry.js';

describe('scoreTelemetry', () => {
  it('summarizeDrift → mean/p95/max/stalls over fire deltas', () => {
    const s = summarizeDrift([2, 4, 6, 8, 200], { stallMs: 120 });
    expect(s.maxDriftMs).toBe(200);
    expect(s.stalls).toBe(1);
    expect(s.meanDriftMs).toBeCloseTo(44, 0);
    expect(s.p95DriftMs).toBe(200);
  });

  it('summarizeDrift handles empty input', () => {
    expect(summarizeDrift([], { stallMs: 120 })).toMatchObject({ maxDriftMs: 0, stalls: 0, meanDriftMs: 0 });
  });

  it('classifyFollowHit → signed drift vs expected interval (− rush, + drag)', () => {
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 450 })).toMatchObject({ driftMs: -50, feel: 'rush' });
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 560 })).toMatchObject({ driftMs: 60, feel: 'drag' });
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 505 })).toMatchObject({ feel: 'tight' });
  });
});
