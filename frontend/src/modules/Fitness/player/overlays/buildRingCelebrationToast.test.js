import { describe, expect, it } from 'vitest';
import { describeRingEntry, describeSameThresholdPeople, mergeRingCelebrationToast } from './buildRingCelebrationToast.js';

const opts = {
  resolveUserName: (id) => ({ user_4: 'User_4', user_3: 'User_3', user_5: 'User_5' }[id]),
  iconUrl: '/media/fitness/ux/spinning-ring.svg',
  durationMs: 3500,
};

describe('buildRingCelebrationToast', () => {
  it('builds a ring toast with faces and a spinning-ring image', () => {
    const toast = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'user_4', threshold: 100, userTotal: 100, totalRings: 100 },
    ], opts);
    expect(toast.kind).toBe('ring-celebration');
    expect(toast.ringCelebration.iconUrl).toBe('/media/fitness/ux/spinning-ring.svg');
    expect(toast.ringCelebration.entries[0]).toMatchObject({ name: 'User_4', avatarUrl: '/api/v1/static/img/users/user_4' });
    expect(toast.ringCelebration.contributors).toEqual([
      { id: 'user_4', name: 'User_4', avatarUrl: '/api/v1/static/img/users/user_4' },
    ]);
  });

  it('merges a new person into the visible card without duplicating prior entries', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'user_4', threshold: 500 },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'individual', userId: 'user_3', threshold: 500 },
      { scope: 'individual', userId: 'user_4', threshold: 500 },
    ], opts);
    expect(next.ringCelebration.entries).toHaveLength(2);
    expect(describeSameThresholdPeople(next.ringCelebration.entries)).toEqual({ threshold: 500, names: 'User_4 & User_3' });
  });

  it('keeps a richer group contributor set when the same group total is refreshed', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'group', threshold: 500, contributorIds: ['user_4', 'user_3'] },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'group', threshold: 500, contributorIds: ['user_4', 'user_3', 'user_5'] },
    ], opts);
    expect(next.ringCelebration.entries[0].contributorIds).toEqual(['user_4', 'user_3', 'user_5']);
  });

  it('uses concrete copy without calling a threshold a milestone', () => {
    expect(describeRingEntry({ scope: 'individual', name: 'User_4', threshold: 250 })).toBe('User_4 reached 250 rings');
    expect(describeRingEntry({ scope: 'group', threshold: 1000 })).toBe('1,000 rings together');
  });
});
