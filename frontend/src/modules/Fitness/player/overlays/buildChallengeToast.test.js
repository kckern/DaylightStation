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
});
