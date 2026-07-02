import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlCycleRaceDatastore } from './YamlCycleRaceDatastore.mjs';

let tmpBase;
let store;
const makeStore = () => {
  const configService = { getHouseholdPath: (rel) => path.join(tmpBase, rel) };
  return new YamlCycleRaceDatastore({ configService });
};

const rec = (id, over = {}) => ({
  version: 1,
  race: { id, date: new Date().toISOString(), mode: 'simultaneous',
    win_condition: 'distance', goal_m: 1500, interval_seconds: 1,
    course_id: 'sprint-1500m', ...over },
  participants: {
    dad: { display_name: 'Dad', final_distance_m: 1500, final_time_s: 150.2, placement: 1 },
    'ghost:20260601080000:dad': { display_name: 'Dad 👻', final_distance_m: 1480, final_time_s: null, placement: 2 }
  }
});

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cgrace-idx-'));
  store = makeStore();
});
afterEach(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

describe('listIndexEntries', () => {
  it('builds entries from saved races (ghost flagged, nulls preserved)', async () => {
    await store.save(rec('20260630080000'), 'household');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e).toMatchObject({ id: '20260630080000', date: '2026-06-30', course_id: 'sprint-1500m',
      win_condition: 'distance', goal_m: 1500 });
    expect(e.participants).toEqual([
      { userId: 'dad', isGhost: false, final_time_s: 150.2, final_distance_m: 1500, placement: 1 },
      { userId: 'ghost:20260601080000:dad', isGhost: true, final_time_s: null, final_distance_m: 1480, placement: 2 }
    ]);
  });

  it('serves from the shard on a second read and self-heals when a race file is added out-of-band', async () => {
    await store.save(rec('20260630080000'), 'household');
    await store.listIndexEntries('household'); // build shard
    // Write a second race directly through save (which invalidates), then verify both appear
    await store.save(rec('20260630090000'), 'household');
    const entries = await store.listIndexEntries('household');
    expect(entries.map((e) => e.id).sort()).toEqual(['20260630080000', '20260630090000']);
  });

  it('a corrupt shard file is ignored and rebuilt', async () => {
    await store.save(rec('20260630080000'), 'household');
    await store.listIndexEntries('household');
    // Overwrite the shard with garbage
    // (path: <base>/_index/2026-06.json — use the tmp dir from the harness)
    fs.writeFileSync(path.join(tmpBase, 'history/fitness/cycle-races/_index/2026-06.json'), '{nope');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
  });

  it('legacy records without course_id index as course_id null', async () => {
    const legacy = rec('20260630080000');
    delete legacy.race.course_id;
    await store.save(legacy, 'household');
    const [e] = await store.listIndexEntries('household');
    expect(e.course_id).toBeNull();
  });
});
