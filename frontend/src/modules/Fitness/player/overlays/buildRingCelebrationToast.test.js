import { describe, expect, it } from 'vitest';
import { describeRingEntry, describeSameThresholdPeople, mergeRingCelebrationToast } from './buildRingCelebrationToast.js';

const opts = {
  resolveUserName: (id) => ({ milo: 'Milo', felix: 'Felix', alan: 'Alan' }[id]),
  iconUrl: '/media/fitness/ux/spinning-ring.svg',
  durationMs: 3500,
};

describe('buildRingCelebrationToast', () => {
  it('builds a ring toast with faces and a spinning-ring image', () => {
    const toast = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'milo', threshold: 100, userTotal: 100, totalRings: 100 },
    ], opts);
    expect(toast.kind).toBe('ring-celebration');
    expect(toast.ringCelebration.iconUrl).toBe('/media/fitness/ux/spinning-ring.svg');
    expect(toast.ringCelebration.entries[0]).toMatchObject({ name: 'Milo', avatarUrl: '/api/v1/static/img/users/milo' });
    expect(toast.ringCelebration.contributors).toEqual([
      { id: 'milo', name: 'Milo', avatarUrl: '/api/v1/static/img/users/milo' },
    ]);
  });

  it('merges a new person into the visible card without duplicating prior entries', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'individual', userId: 'milo', threshold: 500 },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'individual', userId: 'felix', threshold: 500 },
      { scope: 'individual', userId: 'milo', threshold: 500 },
    ], opts);
    expect(next.ringCelebration.entries).toHaveLength(2);
    expect(describeSameThresholdPeople(next.ringCelebration.entries)).toEqual({ threshold: 500, names: 'Milo & Felix' });
  });

  it('keeps a richer group contributor set when the same group total is refreshed', () => {
    const first = mergeRingCelebrationToast(null, [
      { scope: 'group', threshold: 500, contributorIds: ['milo', 'felix'] },
    ], opts);
    const next = mergeRingCelebrationToast(first, [
      { scope: 'group', threshold: 500, contributorIds: ['milo', 'felix', 'alan'] },
    ], opts);
    expect(next.ringCelebration.entries[0].contributorIds).toEqual(['milo', 'felix', 'alan']);
  });

  it('uses concrete copy without calling a threshold a milestone', () => {
    expect(describeRingEntry({ scope: 'individual', name: 'Milo', threshold: 250 })).toBe('Milo reached 250 rings');
    expect(describeRingEntry({ scope: 'group', threshold: 1000 })).toBe('1,000 rings together');
  });
});
