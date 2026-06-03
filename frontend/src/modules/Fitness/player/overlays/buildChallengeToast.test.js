import { describe, it, expect } from 'vitest';
import { buildChallengeToast } from './buildChallengeToast.js';

describe('buildChallengeToast', () => {
  it('builds a start toast with rider count and zone', () => {
    const toast = buildChallengeToast('start', { zoneLabel: 'Active', requiredCount: 3 });
    expect(toast).toEqual({
      icon: '🏆',
      title: 'Challenge started',
      subtitle: 'Get 3 people to Active',
      variant: 'info',
    });
  });

  it('builds a success toast with actual/required counts and zone', () => {
    const toast = buildChallengeToast('end', { zoneLabel: 'Active', requiredCount: 3, actualCount: 3 });
    expect(toast).toEqual({
      icon: '🏆',
      title: 'Challenge complete!',
      subtitle: '3 of 3 people reached Active',
      variant: 'success',
    });
  });

  it('uses singular "person" when requiredCount is 1', () => {
    expect(buildChallengeToast('start', { zoneLabel: 'Hot', requiredCount: 1 }).subtitle)
      .toBe('Get 1 person to Hot');
    expect(buildChallengeToast('end', { zoneLabel: 'Hot', requiredCount: 1, actualCount: 1 }).subtitle)
      .toBe('1 of 1 person reached Hot');
  });

  it('falls back to selectionLabel when zoneLabel is absent', () => {
    expect(buildChallengeToast('start', { selectionLabel: 'Sprint', requiredCount: 2 }).subtitle)
      .toBe('Get 2 people to Sprint');
  });

  it('degrades to no subtitle when counts/zone are missing', () => {
    const start = buildChallengeToast('start', {});
    expect(start.title).toBe('Challenge started');
    expect(start.subtitle).toBeUndefined();
    const end = buildChallengeToast('end', {});
    expect(end.title).toBe('Challenge complete!');
    expect(end.subtitle).toBeUndefined();
  });

  it('omits the contributors key entirely when there is no contributor data', () => {
    expect('contributors' in buildChallengeToast('end', { zoneLabel: 'Active', requiredCount: 1, actualCount: 1 })).toBe(false);
    expect('contributors' in buildChallengeToast('start', { zoneLabel: 'Active', requiredCount: 1 })).toBe(false);
  });

  describe('contributors (§5B)', () => {
    it('cycle success: the rider is the sole contributor, with avatar + name', () => {
      const toast = buildChallengeToast('end', {
        type: 'cycle',
        rider: { id: 'felix', name: 'Felix' },
      });
      expect(toast.variant).toBe('success');
      expect(toast.contributors).toEqual([
        { id: 'felix', name: 'Felix', avatarUrl: '/api/v1/static/img/users/felix' },
      ]);
    });

    it('cycle success: resolves the rider name when the snapshot lacks one', () => {
      const toast = buildChallengeToast(
        'end',
        { type: 'cycle', rider: { id: 'felix' } },
        { resolveUserName: (id) => (id === 'felix' ? 'Felix' : null) }
      );
      expect(toast.contributors).toEqual([
        { id: 'felix', name: 'Felix', avatarUrl: '/api/v1/static/img/users/felix' },
      ]);
    });

    it('cycle success with no rider: no contributors key', () => {
      const toast = buildChallengeToast('end', { type: 'cycle', rider: null });
      expect('contributors' in toast).toBe(false);
    });

    it('HR success: every metUser is a contributor, names resolved', () => {
      const toast = buildChallengeToast(
        'end',
        { zoneLabel: 'Active', requiredCount: 2, actualCount: 2, metUsers: ['felix', 'soren'] },
        { resolveUserName: (id) => ({ felix: 'Felix', soren: 'Soren' }[id] || null) }
      );
      expect(toast.subtitle).toBe('2 of 2 people reached Active');
      expect(toast.contributors).toEqual([
        { id: 'felix', name: 'Felix', avatarUrl: '/api/v1/static/img/users/felix' },
        { id: 'soren', name: 'Soren', avatarUrl: '/api/v1/static/img/users/soren' },
      ]);
    });

    it('falls back to the id when no name can be resolved', () => {
      const toast = buildChallengeToast('end', { metUsers: ['device:29199'] });
      expect(toast.contributors).toEqual([
        { id: 'device:29199', name: 'device:29199', avatarUrl: '/api/v1/static/img/users/device:29199' },
      ]);
    });

    it('start events never carry contributors', () => {
      const toast = buildChallengeToast('start', { type: 'cycle', rider: { id: 'felix', name: 'Felix' } });
      expect('contributors' in toast).toBe(false);
    });
  });
});

describe('buildChallengeToast — cycle success', () => {
  it('uses a phase-count subtitle and the rider as contributor', () => {
    const toast = buildChallengeToast('end', {
      type: 'cycle',
      rider: { id: 'felix', name: 'Felix' },
      totalPhases: 4
    }, { resolveUserName: (id) => (id === 'felix' ? 'Felix' : id) });
    expect(toast.variant).toBe('success');
    expect(toast.title).toBe('Challenge complete!');
    expect(toast.subtitle).toBe('Felix completed 4 phases');
    expect(toast.contributors).toEqual([
      { id: 'felix', name: 'Felix', avatarUrl: '/api/v1/static/img/users/felix' }
    ]);
  });

  it('singular phase wording', () => {
    const toast = buildChallengeToast('end', {
      type: 'cycle', rider: { id: 'felix', name: 'Felix' }, totalPhases: 1
    });
    expect(toast.subtitle).toBe('Felix completed 1 phase');
  });
});
