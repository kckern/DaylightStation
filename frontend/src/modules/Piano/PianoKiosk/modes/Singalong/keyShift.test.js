// keyShift.test.js — pure key-shift math for the karaoke transposer.
import { describe, it, expect } from 'vitest';
import { clampKeyShift, keyShiftLabel, KEY_SHIFT_MIN, KEY_SHIFT_MAX } from './keyShift.js';

describe('bounds', () => {
  it('spans a symmetric ±6 semitone range', () => {
    expect(KEY_SHIFT_MIN).toBe(-6);
    expect(KEY_SHIFT_MAX).toBe(6);
  });
});

describe('clampKeyShift', () => {
  it('passes through in-range integers', () => {
    expect(clampKeyShift(0)).toBe(0);
    expect(clampKeyShift(3)).toBe(3);
    expect(clampKeyShift(-6)).toBe(-6);
  });

  it('clamps values above the max to the max', () => {
    expect(clampKeyShift(7)).toBe(KEY_SHIFT_MAX);
    expect(clampKeyShift(100)).toBe(KEY_SHIFT_MAX);
  });

  it('clamps values below the min to the min', () => {
    expect(clampKeyShift(-7)).toBe(KEY_SHIFT_MIN);
    expect(clampKeyShift(-100)).toBe(KEY_SHIFT_MIN);
  });

  it('coerces non-finite and non-numeric input to 0', () => {
    expect(clampKeyShift(NaN)).toBe(0);
    expect(clampKeyShift(Infinity)).toBe(0);
    expect(clampKeyShift(undefined)).toBe(0);
    expect(clampKeyShift('3')).toBe(0);
  });

  it('truncates fractional semitones toward zero', () => {
    expect(clampKeyShift(2.7)).toBe(2);
    expect(clampKeyShift(-2.7)).toBe(-2);
  });
});

describe('keyShiftLabel', () => {
  it('labels the natural key as "Key"', () => {
    expect(keyShiftLabel(0)).toBe('Key');
  });

  it('prefixes raised keys with +', () => {
    expect(keyShiftLabel(1)).toBe('+1');
    expect(keyShiftLabel(6)).toBe('+6');
  });

  it('renders lowered keys with an ASCII hyphen (kiosk WebView glyph rule)', () => {
    expect(keyShiftLabel(-1)).toBe('-1');
    expect(keyShiftLabel(-6)).toBe('-6');
  });
});
