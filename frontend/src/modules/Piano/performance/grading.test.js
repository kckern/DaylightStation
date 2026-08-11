import { describe, expect, it } from 'vitest';
import {
  gradeChordPerformance,
  gradeOrderedPerformance,
  timingQuality,
  gradeBand,
} from './grading.js';

describe('piano challenge grading', () => {
  it('grades an untimed scale or arpeggio from pitch accuracy and continuity', () => {
    expect(gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 0 })).toMatchObject({
      score: 1, pitchAccuracy: 1, timingAccuracy: null, continuity: 1,
    });
    const recovered = gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 4 });
    expect(recovered.pitchAccuracy).toBeCloseTo(2 / 3);
    expect(recovered.continuity).toBe(0.5);
    expect(recovered.score).toBeCloseTo(0.6167, 3);
  });

  it('adds timing accuracy only when an exercise is paced', () => {
    const paced = gradeOrderedPerformance({
      expectedCount: 4, wrongNotes: 0, timingQualities: [1, 0.5], paced: true,
    });
    expect(paced).toMatchObject({ pitchAccuracy: 1, timingAccuracy: 0.75, continuity: 1 });
    expect(paced.score).toBeCloseTo(0.925);
    expect(timingQuality(1_100, 1_000, 500)).toBeCloseTo(1 - 100 / 225);
  });

  it('grades chords from the pitch set and onset simultaneity', () => {
    const chord = gradeChordPerformance({ targetNotes: 3, wrongAttempts: 1, onsetSpanMs: 125 });
    expect(chord).toMatchObject({ pitchSetAccuracy: 0.75, simultaneity: 0.5 });
    expect(chord.score).toBeCloseTo(0.675);
  });
});

describe('declared weights', () => {
  it('defaults reproduce the untimed constants exactly', () => {
    const a = gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 2, paced: false });
    const b = gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 2, paced: false, weights: null });
    expect(b).toEqual(a);
  });

  it('custom weights change what the drill is about', () => {
    // All weight on continuity: two wrongs out of eight → continuity 0.75, score 0.75.
    const r = gradeOrderedPerformance({
      expectedCount: 8, wrongNotes: 2, paced: false,
      weights: { pitch: 0, timing: 0, continuity: 1 },
    });
    expect(r.score).toBeCloseTo(0.75, 5);
  });
});

describe('gradeBand', () => {
  it('maps a score to green/yellow/red on the polish thresholds', () => {
    expect(gradeBand(0.95)).toBe('green');
    expect(gradeBand(0.9)).toBe('green');
    expect(gradeBand(0.7)).toBe('yellow');
    expect(gradeBand(0.59)).toBe('red');
  });
  it('accepts custom thresholds', () => {
    expect(gradeBand(0.7, { green: 0.65, yellow: 0.4 })).toBe('green');
  });
});
