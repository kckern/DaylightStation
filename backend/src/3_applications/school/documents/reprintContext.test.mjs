import { describe, it, expect } from 'vitest';
import { deriveLearnerName, deriveIssueDate, buildReprintContext } from './reprintContext.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

describe('deriveLearnerName', () => {
  it('title-cases a plain learner id', () => {
    expect(deriveLearnerName('learner4')).toBe('Learner4');
  });

  it('title-cases each word of a hyphenated/underscored id', () => {
    expect(deriveLearnerName('mary-jane_doe')).toBe('Mary Jane Doe');
  });
});

describe('deriveIssueDate', () => {
  it('formats an ISO timestamp as day-month-year in America/Los_Angeles', () => {
    // 2026-08-14T17:55:20.033Z is still 2026-08-14 in America/Los_Angeles (UTC-7 in August)
    expect(deriveIssueDate('2026-08-14T17:55:20.033Z')).toBe('14 Aug 2026');
  });

  it('defaults to the shared-kernel DEFAULT_TIMEZONE, and honours an explicit zone', () => {
    // 2026-08-15T04:30Z is still 14 Aug in America/Los_Angeles (UTC-7 in August)
    // — so this timestamp distinguishes the household zone from UTC.
    expect(deriveIssueDate('2026-08-15T04:30:00.000Z')).toBe('14 Aug 2026');
    expect(deriveIssueDate('2026-08-15T04:30:00.000Z', DEFAULT_TIMEZONE)).toBe('14 Aug 2026');
    expect(deriveIssueDate('2026-08-15T04:30:00.000Z', 'UTC')).toBe('15 Aug 2026');
  });
});

describe('buildReprintContext', () => {
  const instance = () => ({
    id: 'civilization/young-peoples-atlas-us/ws-ses-f6buxumv',
    sessionId: 'ses_f6Buxumv',
    learnerId: 'learner4',
    issuedAt: '2026-08-14T17:55:20.033Z',
    omr: { cardId: '5922785', recordId: 'x:v0:7-16', rowRange: { start: 7, end: 16 } },
  });

  it('builds the full render context from a card-backed instance', () => {
    expect(buildReprintContext(instance())).toEqual({
      cardId: '5922785',
      startRow: 7,
      learnerId: 'learner4',
      learnerName: 'Learner4',
      date: '14 Aug 2026',
      sessionId: 'ses_f6Buxumv',
    });
  });

  it('throws a ValidationError when the instance has no card allocation', () => {
    const { omr, ...noCard } = instance();
    expect(() => buildReprintContext(noCard)).toThrow(/no card allocation/);
  });
});
