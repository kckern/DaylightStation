import { describe, it, expect } from 'vitest';
import { closeOpenChallengeRecords } from './repairOpenChallenges.mjs';

const ch = (data) => ({ type: 'challenge', data: { challengeId: 'c', start: 1, ...data } });

describe('closeOpenChallengeRecords', () => {
  it('marks open (started, no end) challenges abandoned and counts them', () => {
    const s = { timeline: { events: [ch({ result: 'started', end: null }), ch({ result: 'success', end: 5 })] } };
    expect(closeOpenChallengeRecords(s)).toBe(1);
    expect(s.timeline.events[0].data).toMatchObject({ result: 'abandoned', reason: 'unresolved_at_save' });
    expect(s.timeline.events[1].data.result).toBe('success');
  });
  it('is idempotent and leaves resolved results alone', () => {
    const s = { timeline: { events: [ch({ result: 'started', end: null }), ch({ result: 'failed', end: 9 }), ch({ result: 'cleared', end: 9 })] } };
    closeOpenChallengeRecords(s);
    expect(closeOpenChallengeRecords(s)).toBe(0);
    expect(s.timeline.events.map((e) => e.data.result)).toEqual(['abandoned', 'failed', 'cleared']);
  });
  it('handles sessions without a timeline', () => {
    expect(closeOpenChallengeRecords({})).toBe(0);
  });
});
