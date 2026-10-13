import { describe, expect, it } from 'vitest';
import { compileAssessmentExpectation, compileScoreExpectation } from '../../../performance/assessmentSession.js';
import { timedRunPresentation } from './timedRunPresentation.js';

const snapshot = (overrides = {}) => ({
  status: 'running', startedAt: 1000, leadInMs: 2000, originQuarter: 0,
  expectation: compileAssessmentExpectation({
    tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
    events: [
      { onsetQuarter: 0, durationQuarters: 0.5, notes: [{ midi: 60 }] },
      { onsetQuarter: 0.5, durationQuarters: 1.5, notes: [{ midi: 62 }] },
      { onsetQuarter: 2, durationQuarters: 2, notes: [{ midi: 64 }] },
    ],
  }),
  ...overrides,
});

describe('timedRunPresentation', () => {
  it('uses actual bar positions through 3/4, 6/8, 9/8 and a meter change', () => {
    const expectation = compileScoreExpectation({ fallbackBpm: 60,
      notes: [{ onsetQuarter: 0, durationQuarters: 13, midi: 60 }],
      measureMap: [
        { index: 0, onsetQuarter: 0, durationQuarters: 3 },
        { index: 1, onsetQuarter: 3, durationQuarters: 3 },
        { index: 2, onsetQuarter: 6, durationQuarters: 4.5 },
        { index: 3, onsetQuarter: 10.5, durationQuarters: 2.5 },
      ],
    });
    const s = snapshot({ expectation });
    for (const [quarter, measureIndex, beatInMeasure, downbeat] of [
      [0, 0, 1, true], [2, 0, 3, false], [3, 1, 1, true], [5, 1, 3, false],
      [6, 2, 1, true], [10, 2, 5, false], [10.5, 3, 1, true], [11.5, 3, 2, false],
    ]) {
      expect(timedRunPresentation(s, 3000 + quarter * 1000)).toMatchObject({ measureIndex, beatInMeasure, downbeat });
    }
  });

  it('does not label an unknown meter or a mid-bar passage origin as a downbeat', () => {
    expect(timedRunPresentation(snapshot(), 3000)).toMatchObject({ beatInMeasure: null, downbeat: null });
    const expectation = compileScoreExpectation({ fallbackBpm: 60,
      notes: [{ onsetQuarter: 1, durationQuarters: 5, midi: 60 }],
      measureMap: [{ index: 0, onsetQuarter: 0, durationQuarters: 3 }, { index: 1, onsetQuarter: 3, durationQuarters: 3 }],
    });
    expect(timedRunPresentation(snapshot({ originQuarter: 1, expectation }), 3000)).toMatchObject({ beat: 1, beatInMeasure: 2, downbeat: false });
  });
  it('is prepared before arming and counts down before musical time zero', () => {
    expect(timedRunPresentation(snapshot({ status: 'prepared', startedAt: null }), 99999)).toMatchObject({ phase: 'prepared', elapsedMs: 0, beat: 1, expectedCursor: 0 });
    expect(timedRunPresentation(snapshot(), 2999)).toMatchObject({ phase: 'countdown', elapsedMs: 0, countdownRemainingMs: 1, beat: 1, expectedCursor: 0 });
    expect(timedRunPresentation(snapshot(), 3000)).toMatchObject({ phase: 'running', elapsedMs: 0, quarter: 0, bpm: 60 });
  });
  it('moves through silence by authored rhythmic durations at exact onset boundaries', () => {
    const s = snapshot();
    expect(timedRunPresentation(s, 3499).expectedCursor).toBe(0);
    expect(timedRunPresentation(s, 3500)).toMatchObject({ expectedCursor: 1, elapsedMs: 500, beat: 1 });
    expect(timedRunPresentation(s, 4999).expectedCursor).toBe(1);
    expect(timedRunPresentation(s, 5000)).toMatchObject({ expectedCursor: 2, beat: 3 });
  });
  it('ignores player progress ahead of or behind the clock and held notes', () => {
    const expected = timedRunPresentation(snapshot(), 4000);
    for (const state of [{ cursor: 0, hits: {}, misses: [] }, { cursor: 3, hits: { all: true }, misses: ['x'], held: [64] }]) {
      expect(timedRunPresentation(snapshot(state), 4000)).toEqual(expected);
    }
  });
  it('integrates tempo changes for the cursor, beat and full note duration', () => {
    const s = snapshot({ expectation: compileAssessmentExpectation({
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 1, bpm: 120 }, { onsetQuarter: 3, bpm: 30 }],
      events: [{ onsetQuarter: 0, durationQuarters: 2, notes: [{ midi: 60 }] }, { onsetQuarter: 2, durationQuarters: 2, notes: [{ midi: 62 }] }],
    }) });
    expect(timedRunPresentation(s, 4000)).toMatchObject({ quarter: 1, bpm: 120, expectedCursor: 0, durationMs: 4000 });
    expect(timedRunPresentation(s, 4500)).toMatchObject({ quarter: 2, expectedCursor: 1, beat: 3 });
    expect(timedRunPresentation(s, 5000)).toMatchObject({ quarter: 3, bpm: 30 });
    expect(timedRunPresentation(s, 7000)).toMatchObject({ quarter: 4, phase: 'running', expectedCursor: 2, timelineDone: true });
  });
  it('respects a nonzero origin and the tempo active at that origin', () => {
    const s = snapshot({ originQuarter: 2, expectation: compileAssessmentExpectation({
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 1, bpm: 120 }],
      events: [{ onsetQuarter: 2, durationQuarters: 1, notes: [{ midi: 60 }] }, { onsetQuarter: 3, durationQuarters: 1, notes: [{ midi: 62 }] }],
    }) });
    expect(timedRunPresentation(s, 3000)).toMatchObject({ quarter: 2, beat: 1, bpm: 120, durationMs: 1000 });
    expect(timedRunPresentation(s, 3500)).toMatchObject({ quarter: 3, beat: 2, expectedCursor: 1 });
  });
  it('includes rests and holds the last event until its duration ends', () => {
    const s = snapshot({ expectation: compileAssessmentExpectation({ bpm: 60, events: [
      { onsetQuarter: 0, durationQuarters: 1, notes: [] },
      { onsetQuarter: 1, durationQuarters: 3, notes: [{ midi: 60 }] },
    ] }) });
    expect(timedRunPresentation(s, 3500).expectedCursor).toBe(0);
    expect(timedRunPresentation(s, 6999)).toMatchObject({ phase: 'running', expectedCursor: 1 });
    expect(timedRunPresentation(s, 7000)).toMatchObject({ phase: 'running', expectedCursor: 2, timelineDone: true });
  });
  it('uses compiled score rest and tied-note duration across a tempo change', () => {
    const expectation = compileScoreExpectation({
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 2, bpm: 120 }],
      notes: [
        { onsetQuarter: 0, durationQuarters: 1, rest: true },
        { onsetQuarter: 1, durationQuarters: 1, midi: 60, tie: 'start', staff: 0 },
        { onsetQuarter: 2, durationQuarters: 2, midi: 60, tie: 'stop', staff: 0 },
      ],
    });
    const s = snapshot({ expectation });
    expect(expectation.events).toHaveLength(2);
    expect(timedRunPresentation(s, 5500)).toMatchObject({ expectedCursor: 1, quarter: 3, durationMs: 3000, bpm: 120 });
    expect(timedRunPresentation(s, 6000)).toMatchObject({ expectedCursor: 2, timelineDone: true, phase: 'running' });
  });
  it.each(['completed', 'aborted', 'timeout', 'error'])('reports terminal %s without fabricating progress', status => {
    expect(timedRunPresentation(snapshot({ status }), 3500)).toMatchObject({ phase: 'done', expectedCursor: 1, timelineDone: false });
  });
  it('handles an unresolved snapshot without inventing a tempo', () => {
    expect(timedRunPresentation(null, 0)).toMatchObject({ phase: 'prepared', bpm: null, elapsedMs: 0, expectedCursor: 0 });
  });
});
