import { describe, it, expect } from 'vitest';
import { YamlSavedMealsDatastore } from './YamlSavedMealsDatastore.mjs';

const MEAL = { id: 'm1', name: 'Protein breakfast', items: [{ name: 'Eggs', calories: 140 }] };

describe('YamlSavedMealsDatastore.save', () => {
  it('resolves when dataService.user.write succeeds (returns true)', async () => {
    const store = new YamlSavedMealsDatastore({
      dataService: { user: { read: () => [], write: () => true } },
    });
    await expect(store.save(MEAL, 'kckern')).resolves.toBeUndefined();
  });

  it('resolves when dataService.user.write returns undefined (legacy/void success)', async () => {
    const store = new YamlSavedMealsDatastore({
      dataService: { user: { read: () => [], write: () => undefined } },
    });
    await expect(store.save(MEAL, 'kckern')).resolves.toBeUndefined();
  });

  it('rejects with a coded MEALS_WRITE_FAILED error when write returns false', async () => {
    const store = new YamlSavedMealsDatastore({
      dataService: { user: { read: () => [], write: () => false } },
    });
    await expect(store.save(MEAL, 'kckern')).rejects.toThrow(/MEALS_WRITE_FAILED/);
    try {
      await store.save(MEAL, 'kckern');
      throw new Error('expected save to reject');
    } catch (err) {
      expect(err.code).toBe('MEALS_WRITE_FAILED');
      expect(err.message).toContain('apps/health/meals');
      expect(err.message).toContain('kckern');
    }
  });
});

describe('YamlSavedMealsDatastore.remove', () => {
  it('resolves when dataService.user.write succeeds (returns true)', async () => {
    const store = new YamlSavedMealsDatastore({
      dataService: { user: { read: () => [MEAL], write: () => true } },
    });
    await expect(store.remove('m1', 'kckern')).resolves.toBeUndefined();
  });

  it('rejects with a coded MEALS_WRITE_FAILED error when write returns false', async () => {
    const store = new YamlSavedMealsDatastore({
      dataService: { user: { read: () => [MEAL], write: () => false } },
    });
    await expect(store.remove('m1', 'kckern')).rejects.toThrow(/MEALS_WRITE_FAILED/);
  });
});
