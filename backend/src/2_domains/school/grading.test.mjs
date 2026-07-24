import { describe, it, expect } from 'vitest';
import { gradeAnswer, givenShapeError } from './grading.mjs';

describe('gradeAnswer region_click', () => {
  const item = { id: 'g', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' };
  it('grades a correct region click', () => {
    expect(gradeAnswer(item, 'NV')).toEqual({ correct: true, expected: 'NV' });
  });
  it('grades a wrong region click and returns expected', () => {
    expect(gradeAnswer(item, 'CA')).toEqual({ correct: false, expected: 'NV' });
  });
  it('is strict — no normalization of ids', () => {
    expect(gradeAnswer(item, 'nv').correct).toBe(false);
  });
});

describe('gradeAnswer asset_choice', () => {
  const item = { id: 'f', type: 'asset_choice', prompt: 'Whose flag?', answer: 'FR',
    choices: [{ value: 'FR', label: 'France' }, { value: 'DE', label: 'Germany' }] };
  it('grades the chosen value', () => {
    expect(gradeAnswer(item, 'FR')).toEqual({ correct: true, expected: 'FR' });
    expect(gradeAnswer(item, 'DE')).toEqual({ correct: false, expected: 'FR' });
  });
});

describe('givenShapeError covers the new types via its default branch', () => {
  it('rejects empty given for region_click without a dedicated branch', () => {
    const item = { id: 'g', type: 'region_click', prompt: 'p', asset: 'us-states', answer: 'NV' };
    expect(givenShapeError(item, '')).toMatch(/non-empty string/);
    expect(givenShapeError(item, 'NV')).toBeNull();
  });
});
