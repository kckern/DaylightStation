import { describe, it, expect } from 'vitest';
import { YamlHealthGoalsDatastore } from './YamlHealthGoalsDatastore.mjs';

const GOALS = {
  targetWeightLbs: 180, weeklyRateLbs: 1, activityBaseline: 1.35,
  budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male',
};

describe('YamlHealthGoalsDatastore.save', () => {
  it('resolves when dataService.user.write succeeds (returns true)', async () => {
    const store = new YamlHealthGoalsDatastore({
      dataService: { user: { write: () => true } },
    });
    await expect(store.save(GOALS, 'kckern')).resolves.toBeUndefined();
  });

  it('resolves when dataService.user.write returns undefined (legacy/void success)', async () => {
    const store = new YamlHealthGoalsDatastore({
      dataService: { user: { write: () => undefined } },
    });
    await expect(store.save(GOALS, 'kckern')).resolves.toBeUndefined();
  });

  it('rejects with a coded GOALS_WRITE_FAILED error when write returns false', async () => {
    const store = new YamlHealthGoalsDatastore({
      dataService: { user: { write: () => false } },
    });
    await expect(store.save(GOALS, 'kckern')).rejects.toThrow(/GOALS_WRITE_FAILED/);
    try {
      await store.save(GOALS, 'kckern');
      throw new Error('expected save to reject');
    } catch (err) {
      expect(err.code).toBe('GOALS_WRITE_FAILED');
      expect(err.message).toContain('apps/health/goals');
      expect(err.message).toContain('kckern');
    }
  });
});
