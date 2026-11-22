import { describe, it, expect } from 'vitest';
import { colorForLearner, learnerIdsForDays, LEARNER_HUES } from './learnerColor.js';

describe('colorForLearner', () => {
  it('assigns hues by position in the sorted unique ids, whatever order they arrive in', () => {
    const a = colorForLearner('kid-b', ['kid-c', 'kid-a', 'kid-b', 'kid-a']);
    const b = colorForLearner('kid-b', ['kid-a', 'kid-b', 'kid-c']);
    expect(a).toBe(b);
    expect(a).toBe(LEARNER_HUES[1]);
    expect(colorForLearner('kid-a', ['kid-b', 'kid-a'])).toBe('#2f6fde');
  });

  it('cycles past the six crayons', () => {
    const ids = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
    expect(colorForLearner('k6', ids)).toBe(LEARNER_HUES[0]);
    expect(colorForLearner('k7', ids)).toBe(LEARNER_HUES[1]);
  });
});

describe('learnerIdsForDays', () => {
  it('collects sorted distinct learner ids from every day\'s schoolAll', () => {
    const days = [
      { schoolAll: [{ learnerId: 'kid-b' }, { learnerId: 'kid-a' }] },
      { schoolAll: [] },
      {},
      { schoolAll: [{ learnerId: 'kid-b' }, { learnerId: 'kid-c' }] },
    ];
    expect(learnerIdsForDays(days)).toEqual(['kid-a', 'kid-b', 'kid-c']);
    expect(learnerIdsForDays(undefined)).toEqual([]);
  });
});
