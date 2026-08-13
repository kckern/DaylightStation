import { describe, it, expect } from 'vitest';
import { resolveContentMode, hasResolvableLabels } from './resolveContentMode.js';

const CFG = {
  no_capture_labels: ['Instructional', 'Private'],
  study_ux_labels: ['Instructional', 'Tutorial'],
};

describe('resolveContentMode', () => {
  it('sets both flags for a label in both lists', () => {
    expect(resolveContentMode({ labels: ['instructional'] }, CFG))
      .toEqual({ captureDisabled: true, studyUx: true });
  });

  it('is case-insensitive on both sides', () => {
    expect(resolveContentMode({ labels: ['INSTRUCTIONAL'] }, CFG).studyUx).toBe(true);
  });

  it('keeps the lists independent — no_capture only', () => {
    expect(resolveContentMode({ labels: ['private'] }, CFG))
      .toEqual({ captureDisabled: true, studyUx: false });
  });

  it('keeps the lists independent — study_ux only', () => {
    expect(resolveContentMode({ labels: ['tutorial'] }, CFG))
      .toEqual({ captureDisabled: false, studyUx: true });
  });

  it('returns all-false for unlabelled content', () => {
    expect(resolveContentMode({ labels: ['cardio'] }, CFG))
      .toEqual({ captureDisabled: false, studyUx: false });
  });

  it('returns all-false for absent labels, null item, and empty config', () => {
    expect(resolveContentMode({}, CFG)).toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode(null, CFG)).toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode({ labels: ['instructional'] }, {}))
      .toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode({ labels: ['instructional'] }, null))
      .toEqual({ captureDisabled: false, studyUx: false });
  });

  it('accepts Plex tag-object label shapes', () => {
    expect(resolveContentMode({ labels: [{ tag: 'Instructional' }] }, CFG).studyUx).toBe(true);
  });
});

describe('hasResolvableLabels', () => {
  it('is true when the item carries a non-empty label array', () => {
    expect(hasResolvableLabels({ labels: ['cardio'] })).toBe(true);
  });

  it('is false for absent or empty labels — these need the async backstop', () => {
    expect(hasResolvableLabels({})).toBe(false);
    expect(hasResolvableLabels({ labels: [] })).toBe(false);
    expect(hasResolvableLabels(null)).toBe(false);
  });
});
