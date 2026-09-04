import { describe, it, expect } from 'vitest';
import { formatDensityWarnings } from './formatters.mjs';

const finding = (over = {}) => ({
  name: 'Premier Protein Shake', calories: 610, grams: 385,
  ratio: (610 / 385) / (160 / 330), expectedCalories: 187, sampleCount: 57, ...over,
});

describe('formatDensityWarnings', () => {
  it('states the row, the multiple and what history expected', () => {
    const text = formatDensityWarnings([finding()]);
    expect(text).toContain('Premier Protein Shake');
    expect(text).toContain('610 kcal for 385 g');
    expect(text).toContain('3.3×');
    expect(text).toContain('~187 kcal expected');
    expect(text).toContain('57 past logs');
  });

  it('does not tell the person the number was changed — it was not', () => {
    const text = formatDensityWarnings([finding()]).toLowerCase();
    expect(text).not.toContain('corrected');
    expect(text).not.toContain('adjusted');
    expect(text).toContain('revise');
  });

  it('is EMPTY when nothing was flagged, so callers can concatenate it blind', () => {
    expect(formatDensityWarnings([])).toBe('');
    expect(formatDensityWarnings(null)).toBe('');
    expect(formatDensityWarnings(undefined)).toBe('');
  });

  it('lists every flagged item, one line each', () => {
    const text = formatDensityWarnings([finding(), finding({ name: 'White Rice', calories: 520, grams: 200, expectedCalories: 260, ratio: 2.4, sampleCount: 1 })]);
    expect(text.split('\n').filter((l) => l.startsWith('⚠️'))).toHaveLength(2);
    expect(text).toContain('1 past log');
  });
});
