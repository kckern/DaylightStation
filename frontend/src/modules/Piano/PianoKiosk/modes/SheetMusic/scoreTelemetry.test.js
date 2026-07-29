import { describe, it, expect } from 'vitest';
import { summarizeDrift, classifyFollowHit, stallThresholdMs, summarizeStepIntervals } from './scoreTelemetry.js';

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

describe('summarizeStepIntervals', () => {
  it('reports median and p95 of the user\'s own step intervals', () => {
    const s = summarizeStepIntervals([100, 200, 300, 400, 10000]);
    expect(s.medianStepMs).toBe(300);
    expect(s.p95StepMs).toBe(10000);
    expect(s.count).toBe(5);
  });

  it('is empty-safe', () => {
    expect(summarizeStepIntervals([])).toMatchObject({ count: 0, medianStepMs: 0, p95StepMs: 0 });
  });

  it('drops non-finite and negative intervals', () => {
    const s = summarizeStepIntervals([NaN, -5, 100, undefined, 300]);
    expect(s.count).toBe(2);
    expect(s.medianStepMs).toBe(300);
  });
});

describe('stallThresholdMs', () => {
  it('scales with the beat: slower tempo tolerates more drift', () => {
    expect(stallThresholdMs(60)).toBeGreaterThan(stallThresholdMs(180));
  });

  it('clamps to a sane ceiling at very slow tempo', () => {
    // 40bpm → beat 1500ms → quarter-beat 375ms, capped at 250
    expect(stallThresholdMs(40)).toBe(250);
  });

  it('clamps to a sane floor at very fast tempo', () => {
    // 600bpm → beat 100ms → quarter-beat 25ms, floored at 60
    expect(stallThresholdMs(600)).toBe(60);
  });

  it('is a quarter of a beat in the normal band', () => {
    // 120bpm → beat 500ms → 125ms
    expect(stallThresholdMs(120)).toBeCloseTo(125, 5);
  });

  it('falls back to 90bpm on a bad or missing tempo', () => {
    expect(stallThresholdMs(undefined)).toBeCloseTo(stallThresholdMs(90), 5);
    expect(stallThresholdMs(0)).toBeCloseTo(stallThresholdMs(90), 5);
    expect(stallThresholdMs(NaN)).toBeCloseTo(stallThresholdMs(90), 5);
  });
});
