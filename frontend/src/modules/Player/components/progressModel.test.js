import { describe, it, expect } from 'vitest';
import {
  normalizeProgress, classifyChange, buildFillKeyframes, parseScaleX, GLIDE_MS,
} from './progressModel.js';

describe('normalizeProgress', () => {
  it('uses duration/offset when both are usable, clamping the offset', () => {
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: 50 }))
      .toEqual({ mode: 'timed', duration: 200, offset: 50, fraction: 0.25 });
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: 250 }).fraction).toBe(1);
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: -3 }).fraction).toBe(0);
  });
  it('falls back to percent (string or number), clamped', () => {
    expect(normalizeProgress({ percent: '12.5' })).toEqual({ mode: 'percent', duration: 0, offset: 0, fraction: 0.125 });
    expect(normalizeProgress({ durationSeconds: Infinity, offsetSeconds: 4, percent: 140 }).fraction).toBe(1);
  });
  it('shows nothing when there is no usable data', () => {
    expect(normalizeProgress({ durationSeconds: 0, offsetSeconds: null, percent: 'NaN' }))
      .toEqual({ mode: 'none', duration: 0, offset: 0, fraction: 0 });
  });
});

describe('classifyChange', () => {
  const base = { offset: 10, running: true, rate: 1, duration: 100 };
  it('names each discontinuity', () => {
    expect(classifyChange(null, base)).toBe('initial');
    expect(classifyChange(base, { ...base, offset: 10.4 })).toBeNull();
    expect(classifyChange(base, { ...base, offset: 9.5 })).toBe('seek');
    expect(classifyChange(base, { ...base, offset: 12 })).toBe('seek');
    expect(classifyChange(base, { ...base, running: false })).toBe('pause');
    expect(classifyChange({ ...base, running: false }, base)).toBe('resume');
    expect(classifyChange(base, { ...base, rate: 1.5 })).toBe('rate');
    expect(classifyChange(base, { ...base, duration: 130 })).toBe('duration');
  });
  it('treats a duration arriving from nothing as initial', () => {
    expect(classifyChange({ ...base, duration: 0 }, base)).toBe('initial');
  });
});

describe('buildFillKeyframes', () => {
  it('runs linearly to the end when there is nothing to glide', () => {
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: 0.5, fraction: 0.5, duration: 100, rate: 1, glideMs: GLIDE_MS, running: true,
    });
    expect(kind).toBe('run');
    expect(keyframes).toEqual([{ transform: 'scaleX(0.5)' }, { transform: 'scaleX(1)' }]);
    expect(timing).toEqual({ duration: 50000, easing: 'linear', fill: 'forwards' });
  });
  it('glides from the visible spot, then continues linearly, accounting for playback during the glide', () => {
    const { keyframes, timing } = buildFillKeyframes({
      fromFraction: 0.2, fraction: 0.5, duration: 100, rate: 2, glideMs: 250, running: true,
    });
    // during 250ms at 2x, playback advances 0.5s => lands at 0.505
    expect(keyframes[0]).toEqual({ transform: 'scaleX(0.2)', offset: 0, easing: 'ease-out' });
    expect(keyframes[1].transform).toBe('scaleX(0.505)');
    expect(keyframes[2]).toEqual({ transform: 'scaleX(1)', offset: 1 });
    expect(timing.duration).toBeCloseTo(250 + (49.5 / 2) * 1000, 5);
    expect(keyframes[1].offset).toBeCloseTo(250 / timing.duration, 8);
  });
  it('holds at the target when paused (glide only, no run)', () => {
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: 0.2, fraction: 0.6, duration: 100, rate: 1, glideMs: 250, running: false,
    });
    expect(kind).toBe('hold');
    expect(keyframes).toEqual([{ transform: 'scaleX(0.2)' }, { transform: 'scaleX(0.6)' }]);
    expect(timing).toEqual({ duration: 250, easing: 'ease-out', fill: 'forwards' });
  });
  it('never emits a scale above 1', () => {
    const { keyframes } = buildFillKeyframes({
      fromFraction: 0.9, fraction: 0.999, duration: 100, rate: 4, glideMs: 250, running: true,
    });
    for (const k of keyframes) expect(parseScaleX(k.transform)).toBeLessThanOrEqual(1);
  });
});

describe('parseScaleX', () => {
  it('reads scaleX() and matrix() transforms', () => {
    expect(parseScaleX('scaleX(0.25)')).toBe(0.25);
    expect(parseScaleX('matrix(0.4, 0, 0, 1, 0, 0)')).toBe(0.4);
    expect(parseScaleX('none')).toBeNull();
    expect(parseScaleX('')).toBeNull();
  });
});
