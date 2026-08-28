import { describe, expect, it } from 'vitest';
import { describeRingEntry, describeSameThresholdPeople, mergeRingCelebrationToast } from './buildRingCelebrationToast.js';

const opts = {
  resolveUserName: (id) => ({ user_3: 'User_3', user_2: 'User_2', user_4: 'User_4' }[id]),
  iconUrl: '/media/fitness/ux/spinning-ring.svg',
  durationMs: 3500,
};

describe('buildRingCelebrationToast', () => {
  it('builds a ring toast with faces and a spinning-ring image', () => {
    const toast = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'user_3', threshold: 100, userTotal: 100, totalRings: 100 },
    ], opts);
    expect(toast.kind).toBe('ring-celebration');
    expect(toast.ringCelebration.iconUrl).toBe('/media/fitness/ux/spinning-ring.svg');
    expect(toast.ringCelebration.entries[0]).toMatchObject({ name: 'User_3', avatarUrl: '/api/v1/static/img/users/user_3' });
    expect(toast.ringCelebration.contributors).toEqual([
      { id: 'user_3', name: 'User_3', avatarUrl: '/api/v1/static/img/users/user_3' },
    ]);
  });

  it('merges a new person into the visible card without duplicating prior entries', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'user_3', threshold: 500 },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'individual', userId: 'user_2', threshold: 500 },
      { scope: 'individual', userId: 'user_3', threshold: 500 },
    ], opts);
    expect(next.ringCelebration.entries).toHaveLength(2);
    expect(describeSameThresholdPeople(next.ringCelebration.entries)).toEqual({ threshold: 500, names: 'User_3 & User_2' });
  });

  it('keeps a richer group contributor set when the same group total is refreshed', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'group', threshold: 500, contributorIds: ['user_3', 'user_2'] },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'group', threshold: 500, contributorIds: ['user_3', 'user_2', 'user_4'] },
    ], opts);
    expect(next.ringCelebration.entries[0].contributorIds).toEqual(['user_3', 'user_2', 'user_4']);
  });

  it('uses concrete copy without calling a threshold a milestone', () => {
    expect(describeRingEntry({ scope: 'individual', name: 'User_3', threshold: 250 })).toBe('User_3 reached 250 rings');
    expect(describeRingEntry({ scope: 'group', threshold: 1000 })).toBe('1,000 rings together');
  });
});
