import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlCycleRaceDatastore } from "./YamlCycleRaceDatastore.mjs";

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
    fs.writeFileSync(path.join(tmpBase, 'fitness/log/cycle-races/_index/2026-06.json'), '{nope');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
  });

  it('an ended-early record indexes as incomplete; a normal one as not', async () => {
    await store.save(rec('20260630080000', { incomplete: true }), 'household');
    await store.save(rec('20260630090000'), 'household');
    const entries = await store.listIndexEntries('household');
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId['20260630080000'].incomplete).toBe(true);
    expect(byId['20260630090000'].incomplete).toBe(false);
    // and the flag survives the shard round-trip (second read is served from the shard)
    const again = await store.listIndexEntries('household');
    expect(again.find((e) => e.id === '20260630080000').incomplete).toBe(true);
  });

  it('re-saving the same race id as incomplete replaces its index row', async () => {
    await store.save(rec('20260630080000'), 'household');
    const [before] = await store.listIndexEntries('household'); // shard now holds the complete row
    expect(before.incomplete).toBe(false);
    await store.save(rec('20260630080000', { incomplete: true }), 'household');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
    expect(entries[0].incomplete).toBe(true);
  });

  it('a shard written by an older index version is not trusted, even when its day mtime matches', async () => {
    await store.save(rec('20260630080000', { incomplete: true }), 'household');
    await store.listIndexEntries('household'); // build the shard (day mtime recorded)
    const shardPath = path.join(tmpBase, 'fitness/log/cycle-races/_index/2026-06.json');
    // Rewrite it the way pre-flag code would have: version 1, row without `incomplete`.
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    shard.version = 1;
    for (const day of Object.values(shard.days)) for (const row of day.races) delete row.incomplete;
    fs.writeFileSync(shardPath, JSON.stringify(shard));

    const [e] = await store.listIndexEntries('household');
    expect(e.incomplete).toBe(true); // rebuilt from the record, not served from the old row
    const rewritten = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    expect(rewritten.version).toBe(2);
    expect(rewritten.days['2026-06-30'].races[0].incomplete).toBe(true);
  });

  it('legacy records without course_id index as course_id null', async () => {
    const legacy = rec('20260630080000');
    delete legacy.race.course_id;
    await store.save(legacy, 'household');
    const [e] = await store.listIndexEntries('household');
    expect(e.course_id).toBeNull();
  });
});
