import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlCycleRaceDatastore } from '#adapters/persistence/yaml/YamlCycleRaceDatastore.mjs';

let tmp;
const makeStore = () => {
  const configService = { getHouseholdPath: (rel) => path.join(tmp, rel) };
  return new YamlCycleRaceDatastore({ configService });
};
const record = (id = '20260602143012') => ({
  version: 1,
  race: { id, date: '2026-06-02', mode: 'simultaneous', win_condition: 'distance', goal_m: 3000 },
  participants: { milo: { display_name: 'Milo', final_distance_m: 3000, placement: 1, distance_series: '[1000,2000,3000]' } }
});

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cgrace-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('YamlCycleRaceDatastore', () => {
  it('saves a record under history/fitness/cycle-races/{date}/{id}.yml', async () => {
    const ds = makeStore();
    await ds.save(record(), 'default');
    const file = path.join(tmp, 'history/fitness/cycle-races/2026-06-02/20260602143012.yml');
    expect(fs.existsSync(file)).toBe(true);
  });
  it('finds a saved record by id', async () => {
    const ds = makeStore();
    await ds.save(record(), 'default');
    const got = await ds.findById('20260602143012', 'default');
    expect(got.race.id).toBe('20260602143012');
    expect(got.participants.milo.final_distance_m).toBe(3000);
  });
  it('returns null for a missing id', async () => {
    const ds = makeStore();
    expect(await ds.findById('20260101000000', 'default')).toBeNull();
  });
  it('lists records for a date and lists dates', async () => {
    const ds = makeStore();
    await ds.save(record('20260602143012'), 'default');
    await ds.save(record('20260602150000'), 'default');
    const onDate = await ds.findByDate('2026-06-02', 'default');
    expect(onDate).toHaveLength(2);
    const dates = await ds.listDates('default');
    expect(dates).toContain('2026-06-02');
  });
  it('throws when the record has no race.id', async () => {
    const ds = makeStore();
    await expect(ds.save({ version: 1, race: {} }, 'default')).rejects.toThrow();
  });
});
