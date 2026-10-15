import { describe, it, expect, vi } from 'vitest';
import { findOpenChallenges } from './closeOpenChallenges.js';
import { FitnessSession } from './FitnessSession.js';

const start = (id) => ({ type: 'challenge_start', data: { challengeId: id } });
const end = (id, result = 'success') => ({ type: 'challenge_end', data: { challengeId: id, result } });

describe('findOpenChallenges', () => {
  it('returns challenges that started and never ended', () => {
    expect(findOpenChallenges([start('a'), end('a'), start('b')])).toEqual(['b']);
  });
  it('does not reopen an end-only record (instant success saved without a start)', () => {
    expect(findOpenChallenges([end('x')])).toEqual([]);
  });
  it('ignores other event types and events without an id', () => {
    expect(findOpenChallenges([{ type: 'media_start', data: { contentId: 'c' } }, { type: 'challenge_start', data: {} }])).toEqual([]);
  });
});

describe('FitnessSession._closeOpenChallenges', () => {
  it('logs one abandoned end per open challenge and none for ended ones', () => {
    const fake = { timeline: { events: [start('a'), end('a'), start('b')] }, logEvent: vi.fn() };
    FitnessSession.prototype._closeOpenChallenges.call(fake, 1234);
    expect(fake.logEvent).toHaveBeenCalledTimes(1);
    expect(fake.logEvent).toHaveBeenCalledWith('challenge_end', { challengeId: 'b', result: 'abandoned', reason: 'session_end' }, 1234);
  });
  it('does nothing without a timeline', () => {
    const fake = { timeline: null, logEvent: vi.fn() };
    FitnessSession.prototype._closeOpenChallenges.call(fake, 1);
    expect(fake.logEvent).not.toHaveBeenCalled();
  });
});
