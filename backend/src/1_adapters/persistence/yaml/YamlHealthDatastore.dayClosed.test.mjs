import { describe, it, expect, beforeEach } from 'vitest';
import { YamlHealthDatastore } from './YamlHealthDatastore.mjs';

// An in-memory DataService: the day_closed file is one object per user.
function memoryDataService() {
  const files = new Map();
  const key = (path, user) => `${user}:${path}`;
  const store = {
    read: (path, user) => structuredClone(files.get(key(path, user)) ?? null),
    write: (path, data, user) => { files.set(key(path, user), structuredClone(data)); return true; },
  };
  return { files, user: store, household: store, system: store };
}

let ds; let store;
beforeEach(() => {
  ds = memoryDataService();
  store = new YamlHealthDatastore({ dataService: ds, logger: { debug() {}, info() {}, warn() {}, error() {} } });
});

describe('day_closed records with meal fasts', () => {
  it('a meal fast alone does not close the day', async () => {
    await store.setMealFast('kc', '2026-09-24', 'morning', true);
    expect(await store.isDayClosed('kc', '2026-09-24')).toBe(false);
    expect((await store.loadDayClosedData('kc'))['2026-09-24']).toMatchObject({ meals: { morning: { status: 'fasting' } } });
  });

  it('closing the day keeps its meal fasts; reopening keeps them too', async () => {
    await store.setMealFast('kc', '2026-09-24', 'morning', true);
    await store.markDayStatus('kc', '2026-09-24', 'done');
    let rec = (await store.loadDayClosedData('kc'))['2026-09-24'];
    expect(rec).toMatchObject({ status: 'done', meals: { morning: { status: 'fasting' } } });
    expect(await store.isDayClosed('kc', '2026-09-24')).toBe(true);

    await store.clearDayStatus('kc', '2026-09-24');
    rec = (await store.loadDayClosedData('kc'))['2026-09-24'];
    expect(rec).toEqual({ meals: { morning: expect.objectContaining({ status: 'fasting' }) } });
    expect(await store.isDayClosed('kc', '2026-09-24')).toBe(false);
  });

  it('undoing the last meal fast removes an otherwise empty record', async () => {
    await store.setMealFast('kc', '2026-09-24', 'evening', true);
    await store.setMealFast('kc', '2026-09-24', 'evening', false);
    expect(await store.loadDayClosedData('kc')).toEqual({});
  });

  it('a legacy `true` closure survives adding a meal fast as `done`', async () => {
    await store.saveDayClosedData('kc', { '2026-09-20': true });
    await store.setMealFast('kc', '2026-09-20', 'morning', true);
    expect((await store.loadDayClosedData('kc'))['2026-09-20']).toMatchObject({ status: 'done', meals: { morning: { status: 'fasting' } } });
  });
});
