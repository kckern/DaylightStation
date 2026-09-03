import { describe, expect, it } from 'vitest';
import { findContinuationEntry } from './continuationEntry.mjs';

/**
 * The rule both resolvers share for "which entry does a served subject continue
 * to". Each case here is a way the two inline copies used to disagree, or a
 * way one of them could have been right by accident.
 */
const lesson = (overrides = {}) => ({
  unitId: 'eng-1', subject: 'english', status: 'available', program: null, ...overrides,
});
const shelf = (overrides = {}) => ({
  unitId: 'book-log:shelf', subject: 'english', status: 'available',
  program: 'book-log', programInstance: 'shelf', ...overrides,
});

describe('findContinuationEntry', () => {
  it('reads plan.entries; the planner inProgress/available snapshots are never consulted', () => {
    // The snapshots are frozen before program entries are appended, which is
    // the bug this helper exists to close. Give them a decoy and leave them
    // out of `entries`: a read of either would surface the decoy.
    const decoy = lesson({ unitId: 'decoy' });
    const plan = { entries: [shelf()], inProgress: [decoy], available: [decoy] };
    expect(findContinuationEntry(plan, { subject: 'english' })?.unitId).toBe('book-log:shelf');
  });

  it('offers only in_progress or available entries', () => {
    const plan = { entries: [
      lesson({ unitId: 'done', status: 'passed' }),
      lesson({ unitId: 'locked', status: 'locked' }),
      lesson({ unitId: 'open', status: 'in_progress' }),
    ] };
    expect(findContinuationEntry(plan, { subject: 'english' })?.unitId).toBe('open');
  });

  it('offers only the served subject', () => {
    const plan = { entries: [lesson({ unitId: 'math-1', subject: 'math' }), lesson()] };
    expect(findContinuationEntry(plan, { subject: 'english' })?.unitId).toBe('eng-1');
    expect(findContinuationEntry(plan, { subject: 'science' })).toBeNull();
  });

  it('prefers the program the token names when both a lesson and the program are eligible', () => {
    // Curriculum first, programs appended after: append order alone would
    // hand a re-entered reading code the lesson.
    const plan = { entries: [lesson(), shelf()] };
    expect(findContinuationEntry(plan, { subject: 'english', program: 'book-log' })?.unitId).toBe('book-log:shelf');
  });

  it('with no program on the token, the same plan continues to the lesson', () => {
    // forwardAction's "One more?" tokens carry no program and mean a lesson.
    const plan = { entries: [lesson(), shelf()] };
    expect(findContinuationEntry(plan, { subject: 'english' })?.unitId).toBe('eng-1');
  });

  it('a named program with no eligible entry falls back to the first eligible entry', () => {
    const plan = { entries: [lesson(), shelf({ status: 'passed' })] };
    expect(findContinuationEntry(plan, { subject: 'english', program: 'book-log' })?.unitId).toBe('eng-1');
  });

  it('answers null for an empty or missing plan', () => {
    expect(findContinuationEntry({ entries: [] }, { subject: 'english' })).toBeNull();
    expect(findContinuationEntry({}, { subject: 'english' })).toBeNull();
    expect(findContinuationEntry(null, { subject: 'english' })).toBeNull();
    expect(findContinuationEntry(undefined)).toBeNull();
  });

  it('skips holes in the entries list rather than throwing on them', () => {
    const plan = { entries: [null, undefined, lesson()] };
    expect(findContinuationEntry(plan, { subject: 'english' })?.unitId).toBe('eng-1');
  });
});

describe('findContinuationEntry — ordering honours the planner, not append order', () => {
  // The old typed-code fallback read [...inProgress, ...available], where
  // available was sorted by effective priority. Raw plan.entries is course
  // order, which silently changed which lesson a "Catch up" token opened.
  it('prefers an in-progress lesson over an available one that precedes it', () => {
    const plan = { entries: [lesson({ unitId: 'eng-1' }), lesson({ unitId: 'eng-2', status: 'in_progress' })] };
    expect(findContinuationEntry(plan, { subject: 'english' }).unitId).toBe('eng-2');
  });
  it('prefers the lower timingPriority, then the lower timingRank, then entries position', () => {
    const plan = { entries: [
      lesson({ unitId: 'eng-1', timingPriority: 3 }),
      lesson({ unitId: 'eng-2', timingPriority: 1, timingRank: 2 }),
      lesson({ unitId: 'eng-3', timingPriority: 1, timingRank: 1 }),
    ] };
    expect(findContinuationEntry(plan, { subject: 'english' }).unitId).toBe('eng-3');
    const tie = { entries: [lesson({ unitId: 'a' }), lesson({ unitId: 'b' })] };
    expect(findContinuationEntry(tie, { subject: 'english' }).unitId).toBe('a');
  });
  it('a named program still wins regardless of ordering', () => {
    const plan = { entries: [lesson({ unitId: 'eng-1', status: 'in_progress', timingPriority: 1 }), shelf()] };
    expect(findContinuationEntry(plan, { subject: 'english', program: 'book-log' }).unitId).toBe('book-log:shelf');
  });
});
