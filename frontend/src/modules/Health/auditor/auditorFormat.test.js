import { describe, expect, it } from 'vitest';
import { runCounts, triggerLabel } from './auditorFormat.js';

describe('runCounts', () => {
  it('counts a backfilled row with recorded outcomes from its outcomes', () => {
    const row = { backfilled: true, outcomes: [{ status: 'applied' }, { status: 'proposed' }, { status: 'skipped' }] };
    expect(runCounts(row)).toMatchObject({ changed: 1, proposed: 1, rejected: 1 });
  });

  it('counts a transcript-only backfilled row from its proposals', () => {
    expect(runCounts({ backfilled: true, proposals: [{}, {}] })).toMatchObject({ changed: 0, proposed: 2 });
  });
});

describe('triggerLabel', () => {
  it('labels answer turns and falls back to the raw key', () => {
    expect(triggerLabel('answer')).toBe('Answered a question');
    expect(triggerLabel('somethingNew')).toBe('somethingNew');
  });
});
