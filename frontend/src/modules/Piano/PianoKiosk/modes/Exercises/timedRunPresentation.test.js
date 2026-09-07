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
