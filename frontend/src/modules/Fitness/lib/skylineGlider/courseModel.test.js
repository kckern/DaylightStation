import { describe, expect, it } from 'vitest';
import { resolveCalibration, validateCourse } from './courseModel.js';

const course = (overrides = {}) => ({
  schema: 'skyline-glider-course/v1',
  id: 'mountain-pass',
  version: 1,
  title: 'Mountain Pass',
  theme_id: 'alpine-storybook',
  duration_s: 300,
  motion: {
    response_s: 1.5,
    coast_s: 1,
    max_climb_rate: 0.3,
    max_descent_rate: 0.22,
    filter_s: 0.75,
    deadband_rpm: 2,
    disconnect_grace_s: 0.75,
  },
  rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 },
  segments: [
    { id: 'start', type: 'open', start_s: 0, end_s: 60 },
    { id: 'gate-1', type: 'corridor', start_s: 60, end_s: 70, ceiling: 0.2, floor: 0.8 },
    { id: 'cp-1', type: 'checkpoint', start_s: 75 },
    { id: 'rings-1', type: 'collectible-path', start_s: 80, end_s: 90, collectibles: [
      { id: 'ring-1', at_s: 82, altitude: 0.5 },
    ] },
    { id: 'finish', type: 'finish', start_s: 300 },
  ],
  ...overrides,
});

describe('validateCourse', () => {
  it('accepts the v1 authored vocabulary and returns normalized safe bands', () => {
    const result = validateCourse(course());
    expect(result.valid).toBe(true);
    expect(result.course.segments.find((segment) => segment.id === 'gate-1').safeBand)
      .toEqual({ top: 0.2, bottom: 0.8 });
  });

  it('normalizes single-sided terrain to physical open-world bounds', () => {
    const result = validateCourse(course({
      segments: [
        { id: 'hill', type: 'lower-terrain', start_s: 10, end_s: 20, top: 0.62 },
        { id: 'roof', type: 'upper-terrain', start_s: 30, end_s: 40, bottom: 0.42 },
        { id: 'finish', type: 'finish', start_s: 300 },
      ],
    }));

    expect(result.valid).toBe(true);
    expect(result.course.segments.find((segment) => segment.id === 'hill').safeBand)
      .toEqual({ top: 0, bottom: 0.62 });
    expect(result.course.segments.find((segment) => segment.id === 'roof').safeBand)
      .toEqual({ top: 0.42, bottom: 1 });
  });

  it.each([
    ['wrong schema', { schema: 'flight/v0' }, 'schema'],
    ['duplicate ids', { segments: [{ id: 'same', type: 'open', start_s: 0 }, { id: 'same', type: 'finish', start_s: 300 }] }, 'duplicate'],
    ['unsorted segments', { segments: [{ id: 'later', type: 'open', start_s: 10 }, { id: 'earlier', type: 'finish', start_s: 5 }] }, 'ordered'],
    ['missing finish', { segments: [{ id: 'only', type: 'open', start_s: 0 }] }, 'finish'],
    ['invalid corridor', { segments: [{ id: 'bad', type: 'corridor', start_s: 0, end_s: 5, ceiling: 0.8, floor: 0.2 }, { id: 'finish', type: 'finish', start_s: 300 }] }, 'corridor'],
  ])('rejects %s', (_name, override, message) => {
    const result = validateCourse(course(override));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(new RegExp(message, 'i'));
  });

  it('rejects a mandatory altitude transition that cannot be reached in time', () => {
    const result = validateCourse(course({
      segments: [
        { id: 'low', type: 'corridor', start_s: 0, end_s: 10, ceiling: 0.7, floor: 0.82 },
        { id: 'high', type: 'corridor', start_s: 10.1, end_s: 20, ceiling: 0.1, floor: 0.25 },
        { id: 'finish', type: 'finish', start_s: 300 },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unreachable/i);
  });
});

describe('resolveCalibration', () => {
  it('uses equipment rpm bounds and falls back to 30/100', () => {
    expect(resolveCalibration({ rpm: { min: 35, max: 95 } })).toEqual({ lowRpm: 35, highRpm: 95 });
    expect(resolveCalibration({})).toEqual({ lowRpm: 30, highRpm: 100 });
  });

  it('fails closed for equal or inverted ranges', () => {
    expect(() => resolveCalibration({ rpm: { min: 100, max: 30 } })).toThrow(/calibration/i);
    expect(() => resolveCalibration({ rpm: { min: 50, max: 50 } })).toThrow(/calibration/i);
  });
});
