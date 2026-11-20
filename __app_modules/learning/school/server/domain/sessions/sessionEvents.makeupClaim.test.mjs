import { describe, it, expect } from 'vitest';
import {
  createEvent, reduceSession, transitionViolation, TERMINAL_STATES,
} from './sessionEvents.mjs';

const created = {
  type: 'created', at: '2026-11-18T15:49:18.696Z', sessionId: 'ses_a',
  learnerId: 'kid', unitId: 'u1', studyDay: '2026-11-18', seq: 1,
};
const claim = (over = {}) => ({
  type: 'makeup_claimed', at: '2026-11-19T17:37:35.000Z', sessionId: 'ses_a',
  forDay: '2026-11-18', subject: 'math', deadline: '2026-11-21', ...over,
});

describe('makeup_claimed', () => {
  it('builds with exactly its fields', () => {
    const { errors, event } = createEvent({ ...claim(), extra: 1 });
    expect(errors).toEqual([]);
    expect(event).toEqual(claim());
  });

  it('rejects a malformed day, a missing subject, and a deadline before the day', () => {
    expect(createEvent(claim({ forDay: 'wednesday' })).errors).toContain('forDay: must be YYYY-MM-DD');
    expect(createEvent(claim({ subject: '' })).errors).toContain('subject: must be a non-empty string');
    expect(createEvent(claim({ deadline: '2026-11-17' })).errors).toContain('deadline: must not be before forDay');
  });

  it('reduces into makeupFor / makeupSubject / makeupDeadline', () => {
    const state = reduceSession([created, { ...claim(), seq: 2 }]);
    expect(state).toMatchObject({ makeupFor: '2026-11-18', makeupSubject: 'math', makeupDeadline: '2026-11-21' });
    expect(reduceSession([created]).makeupFor).toBeNull();
  });

  it('does not move the lifecycle state', () => {
    expect(reduceSession([created, { ...claim(), seq: 2 }]).state).toBe(reduceSession([created]).state);
  });

  it('is legal on a settled session (repair) and illegal before one opens', () => {
    TERMINAL_STATES.forEach((state) => expect(transitionViolation(state, 'makeup_claimed')).toBeNull());
    expect(transitionViolation('created', 'makeup_claimed')).toBeNull();
    expect(transitionViolation(null, 'makeup_claimed')).not.toBeNull();
  });
});
