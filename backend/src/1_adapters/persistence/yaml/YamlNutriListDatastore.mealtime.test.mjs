import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

// The datastore's real IO surface is `dataService.user.resolveDir(relativePath, userId)`
// returning a filesystem base path (see DataService.mjs), which the store then reads/writes
// via loadYamlSafe/saveYaml (real fs, not an in-memory shim). So the shim here is a real
// temp directory + a dataService whose resolveDir mirrors DataService's own path.join.
async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nutrilist-mealtime-'));
  const dataService = {
    user: {
      resolveDir: (relativePath, userId) => path.join(root, 'users', userId, relativePath),
    },
  };
  const store = new YamlNutriListDatastore({ dataService, logger: { warn() {}, debug() {}, info() {} } });
  return { store, root };
}

const fakeLog = {
  id: 'log-1', uuid: 'log-1', userId: 'u', isAccepted: true,
  meal: { date: '2026-09-02', time: 'afternoon' },
  items: [{ uuid: 'item-1', label: 'Sandwich', calories: 400, protein: 20, carbs: 40, fat: 15 }],
};

describe('mealTime denormalization', () => {
  it('syncFromLog copies meal.time onto each row', async () => {
    const { store, root } = await makeStore();
    try {
      await store.syncFromLog(fakeLog);
      const rows = await store.findByDate('u', '2026-09-02');
      expect(rows).toHaveLength(1);
      expect(rows[0].mealTime).toBe('afternoon');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('a log without meal.time yields mealTime null (UNGROUPED)', async () => {
    const { store, root } = await makeStore();
    try {
      await store.syncFromLog({ ...fakeLog, meal: { date: '2026-09-02' } });
      const rows = await store.findByDate('u', '2026-09-02');
      expect(rows[0].mealTime).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('saveMany persists mealTime (quick-add / saved-meals write path)', async () => {
    const { store, root } = await makeStore();
    try {
      await store.saveMany([
        { uuid: 'qa-1', userId: 'u', label: 'Protein Bar', calories: 200, date: '2026-09-02', mealTime: 'morning' },
      ]);
      const rows = await store.findByDate('u', '2026-09-02');
      expect(rows).toHaveLength(1);
      expect(rows[0].mealTime).toBe('morning');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
