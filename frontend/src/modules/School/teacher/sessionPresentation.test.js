import { describe, expect, it } from 'vitest';
import { presentSessionState } from './sessionPresentation.js';

describe('presentSessionState', () => {
  it('never calls a newly-created session completed', () => {
    expect(presentSessionState({ state: 'created' })).toMatchObject({
      label: 'Not started', dayStatus: 'planned', complete: false,
    });
  });

  it('distinguishes returned work from completed work', () => {
    expect(presentSessionState({ state: 'submitted' }).label).toBe('Awaiting review');
    expect(presentSessionState({ state: 'rewarded', outcome: { result: 'passed' } }).label).toBe('Completed');
  });

  it('says a remediation is assigned once its session has been opened', () => {
    expect(presentSessionState({
      state: 'remediation_opened', outcome: { result: 'needs_remediation' },
    }).label).toBe('Another try assigned');
  });
});
