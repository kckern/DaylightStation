import { describe, it, expect } from 'vitest';
import { MICRO_KEYS, hasMicroData, aiMicrosSource, pickMicros } from './micros.mjs';

describe('micros provenance (Task 6.2)', () => {
  it('tracks exactly the four micros the goals vocabulary accepts', () => {
    expect(MICRO_KEYS).toEqual(['fiber', 'sugar', 'sodium', 'cholesterol']);
  });

  it('claims AI provenance ONLY when the model actually returned micro numbers', () => {
    expect(aiMicrosSource({ calories: 200, protein: 10, fiber: 3 })).toBe('ai');
    // Macros only — the model never spoke about micros, so its structural
    // zeros downstream must stay unclaimed.
    expect(aiMicrosSource({ calories: 200, protein: 10, carbs: 20, fat: 5 })).toBeNull();
    expect(aiMicrosSource({})).toBeNull();
    expect(aiMicrosSource(null)).toBeNull();
  });

  it('treats a MEASURED zero as real data — 0 is a value, absence is not', () => {
    expect(aiMicrosSource({ sodium: 0 })).toBe('ai');
    expect(hasMicroData({ sodium: 0 })).toBe(true);
  });

  it('does not accept non-numeric micros as data', () => {
    expect(hasMicroData({ sodium: 'some', fiber: null, sugar: undefined })).toBe(false);
    expect(aiMicrosSource({ sodium: 'some' })).toBeNull();
  });

  it('picks only the micro fields that are present', () => {
    expect(pickMicros({ calories: 200, protein: 9, fiber: 3, sodium: 0 })).toEqual({ fiber: 3, sodium: 0 });
    expect(pickMicros({ calories: 200 })).toEqual({});
    expect(pickMicros(undefined)).toEqual({});
  });
});
