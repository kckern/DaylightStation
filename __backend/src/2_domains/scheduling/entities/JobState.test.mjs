import { describe, expect, it } from 'vitest';
import { JobState } from './JobState.mjs';

describe('JobState#needsToRun', () => {
  it('is not due 5 ms before its slot', () => {
    const s = new JobState({ jobId: 'budget', nextRun: '2026-11-09T07:30:00.000Z' });
    expect(s.needsToRun(new Date('2026-11-09T07:29:59.995Z'))).toBe(false);
  });
  it('is due exactly at its slot', () => {
    const s = new JobState({ jobId: 'budget', nextRun: '2026-11-09T07:30:00.000Z' });
    expect(s.needsToRun(new Date('2026-11-09T07:30:00.000Z'))).toBe(true);
  });
  it('is due when nextRun is unset', () => {
    expect(new JobState({ jobId: 'budget' }).needsToRun(new Date('2026-11-09T07:30:00.000Z'))).toBe(true);
  });
  it('is due (self-heals) when nextRun is unparseable', () => {
    const s = new JobState({ jobId: 'budget', nextRun: 'not-a-date' });
    expect(s.needsToRun(new Date('2026-11-09T07:30:00.000Z'))).toBe(true);
  });
  it('handles the household-local string the codec persists', () => {
    const s = JobState.fromObject('budget', { nextRun: '2026-11-09 15:30:00' });
    const slot = new Date('2026-11-09 15:30:00');
    expect(s.needsToRun(new Date(slot.getTime() - 999))).toBe(false);
    expect(s.needsToRun(slot)).toBe(true);
  });
});
