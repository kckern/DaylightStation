import { describe, expect, it } from 'vitest';
import { JOB_STATES, isTerminal, classifyJobState } from './jobState.mjs';

describe('IPP job state classification', () => {
  it('names the RFC 8011 states', () => {
    expect(JOB_STATES).toMatchObject({
      pending: 3, pendingHeld: 4, processing: 5, processingStopped: 6,
      canceled: 7, aborted: 8, completed: 9,
    });
  });

  it('treats only canceled, aborted and completed as terminal', () => {
    expect([3, 4, 5, 6].map(isTerminal)).toEqual([false, false, false, false]);
    expect([7, 8, 9].map(isTerminal)).toEqual([true, true, true]);
  });

  it('classifies terminal states', () => {
    expect(classifyJobState(9)).toBe('completed');
    expect(classifyJobState(7)).toBe('failed');
    expect(classifyJobState(8)).toBe('failed');
  });

  it('classifies non-terminal states as pending, not failed', () => {
    expect(classifyJobState(3)).toBe('pending');
    expect(classifyJobState(5)).toBe('pending');
    expect(classifyJobState(6)).toBe('pending');
  });

  it('classifies an absent or unrecognised state as unknown, never failed', () => {
    expect(classifyJobState(null)).toBe('unknown');
    expect(classifyJobState(undefined)).toBe('unknown');
    expect(classifyJobState(99)).toBe('unknown');
  });
});
