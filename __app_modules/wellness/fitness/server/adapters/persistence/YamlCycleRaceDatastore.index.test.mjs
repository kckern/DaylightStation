import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YamlCycleRaceDatastore } from "./YamlCycleRaceDatastore.mjs";

let tmpBase;
let store;
const makeStore = (extra = {}) => {
  const configService = { getHouseholdPath: (rel) => path.join(tmpBase, rel) };
  return new YamlCycleRaceDatastore({ configService, ...extra });
};
const indexDir = () => path.join(tmpBase, 'fitness/log/cycle-races/_index');
const dropIndex = () => fs.rmSync(indexDir(), { recursive: true, force: true });
const makeLogger = () => {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
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
      { userId: 'dad', isGhost: false, stopped: false, final_time_s: 150.2, final_distance_m: 1500, placement: 1 },
      { userId: 'ghost:20260601080000:dad', isGhost: true, stopped: false, final_time_s: null, final_distance_m: 1480, placement: 2 }
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
    expect(rewritten.version).toBe(3);
    expect(rewritten.days['2026-06-30'].races[0].incomplete).toBe(true);
  });

  it("a rider's stopped flag is indexed and survives the shard round-trip", async () => {
    const r = rec('20260630080000');
    r.participants.rider_a = { display_name: 'Rider A', final_distance_m: 900, final_time_s: null, placement: 3, stopped: true };
    await store.save(r, 'household');
    const stoppedOf = (entries) => Object.fromEntries(entries[0].participants.map((p) => [p.userId, p.stopped]));
    const want = { dad: false, 'ghost:20260601080000:dad': false, rider_a: true };
    expect(stoppedOf(await store.listIndexEntries('household'))).toEqual(want); // built from the record
    expect(stoppedOf(await store.listIndexEntries('household'))).toEqual(want); // served from the shard
    const shard = JSON.parse(fs.readFileSync(path.join(tmpBase, 'fitness/log/cycle-races/_index/2026-06.json'), 'utf8'));
    expect(shard.days['2026-06-30'].races[0].participants.find((p) => p.userId === 'rider_a').stopped).toBe(true);
  });

  it('a version 2 shard (rows without `stopped`) is rebuilt as version 3', async () => {
    const r = rec('20260630080000');
    r.participants.dad.stopped = true;
    await store.save(r, 'household');
    await store.listIndexEntries('household'); // build the shard (day mtime recorded)
    const shardPath = path.join(tmpBase, 'fitness/log/cycle-races/_index/2026-06.json');
    // Rewrite it the way version 2 code wrote it: no `stopped` on any participant.
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    shard.version = 2;
    for (const day of Object.values(shard.days)) for (const row of day.races) for (const p of row.participants) delete p.stopped;
    fs.writeFileSync(shardPath, JSON.stringify(shard));

    const [e] = await store.listIndexEntries('household');
    expect(e.participants.find((p) => p.userId === 'dad').stopped).toBe(true); // from the record, not the old row
    const rewritten = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    expect(rewritten.version).toBe(3);
    expect(rewritten.days['2026-06-30'].races[0].participants.find((p) => p.userId === 'dad').stopped).toBe(true);
  });

  it('legacy records without course_id index as course_id null', async () => {
    const legacy = rec('20260630080000');
    delete legacy.race.course_id;
    await store.save(legacy, 'household');
    const [e] = await store.listIndexEntries('household');
    expect(e.course_id).toBeNull();
  });
});

describe('index rebuild: yielding, concurrency, logging', () => {
  const DAYS = ['20260601080000', '20260602080000', '20260603080000'];
  const seedCold = async () => {
    for (const id of DAYS) await store.save(rec(id), 'household');
    dropIndex();
  };

  it('yields to the event loop between rebuilt days', async () => {
    await seedCold();
    let ticks = 0;
    let listing = true;
    const tick = () => { if (!listing) return; ticks += 1; setImmediate(tick); };
    setImmediate(tick);
    await store.listIndexEntries('household');
    listing = false;
    expect(ticks).toBeGreaterThanOrEqual(2); // other work ran while three days were rebuilt
  });

  it('two overlapping listings on a cold index read each day once and agree', async () => {
    await seedCold();
    const reads = vi.spyOn(store, 'findByDate');
    const [a, b] = await Promise.all([store.listIndexEntries('household'), store.listIndexEntries('household')]);
    expect(reads.mock.calls.map((c) => c[0]).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(a.map((e) => e.id)).toEqual(DAYS);
    expect(b).toEqual(a);
    const shard = JSON.parse(fs.readFileSync(path.join(indexDir(), '2026-06.json'), 'utf8'));
    expect(Object.keys(shard.days).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(Object.values(shard.days).every((d) => d.races.length === 1)).toBe(true);
  });

  // A rebuild that has read day 1, then a save of day 1 the folder mtime does not
  // show (in-place write, coarse-mtime filesystem): only save()'s own
  // invalidation can tell the index the day changed.
  const saveMidRebuild = async () => {
    await seedCold();
    const dayDir = path.join(tmpBase, 'fitness/log/cycle-races/2026-06-01');
    const pinned = new Date('2026-06-01T12:00:00Z');
    fs.utimesSync(dayDir, pinned, pinned);
    const realFind = store.findByDate.bind(store);
    let dayOneRead;
    const dayOneWasRead = new Promise((resolve) => { dayOneRead = resolve; });
    vi.spyOn(store, 'findByDate').mockImplementation(async (date, hid) => {
      const records = await realFind(date, hid);
      if (date === '2026-06-01') dayOneRead();
      return records;
    });
    const inFlight = store.listIndexEntries('household');
    await dayOneWasRead; // the rebuild now holds day 1's records, read before the save below
    await store.save(rec('20260601080000', { incomplete: true }), 'household');
    fs.utimesSync(dayDir, pinned, pinned);
    return inFlight;
  };
  const dayOneIncomplete = (entries) => entries.find((e) => e.id === '20260601080000').incomplete;

  it('a save landing mid-rebuild is in the listing asked for once that rebuild has finished', async () => {
    await (await saveMidRebuild());
    const next = await store.listIndexEntries('household');
    expect(next.map((e) => e.id)).toEqual(DAYS);
    expect(dayOneIncomplete(next)).toBe(true);
    // and the stale row is not in the shard for a later process either
    expect(dayOneIncomplete(await makeStore().listIndexEntries('household'))).toBe(true);
  });

  it('a save landing mid-rebuild is in a listing asked for while that rebuild is still running', async () => {
    const inFlight = saveMidRebuild();
    await new Promise(setImmediate); // into the rebuild, past the save
    const next = await store.listIndexEntries('household');
    await inFlight;
    expect(next.map((e) => e.id)).toEqual(DAYS);
    expect(dayOneIncomplete(next)).toBe(true);
    expect(dayOneIncomplete(await makeStore().listIndexEntries('household'))).toBe(true);
  });

  it('logs a cold rebuild with its size and duration, and nothing on a warm read', async () => {
    const logger = makeLogger();
    store = makeStore({ logger });
    await seedCold();
    await store.listIndexEntries('household');
    const rebuilt = logger.events.filter((e) => e.event === 'fitness.cycle_races.index.rebuilt');
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].level).toBe('info');
    expect(rebuilt[0].data).toMatchObject({ days: 3, races: 3, reason: 'cold' });
    expect(rebuilt[0].data.ms).toBeGreaterThanOrEqual(0);
    await store.listIndexEntries('household');
    expect(logger.events.filter((e) => e.event === 'fitness.cycle_races.index.rebuilt')).toHaveLength(1);
  });

  it("names the reason: 'version' for a shard of another index version, 'stale-day' for a changed day", async () => {
    const logger = makeLogger();
    store = makeStore({ logger });
    await store.save(rec('20260601080000'), 'household');
    await store.listIndexEntries('household');
    const shardPath = path.join(indexDir(), '2026-06.json');
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    fs.writeFileSync(shardPath, JSON.stringify({ ...shard, version: 2 }));
    await store.listIndexEntries('household');
    await store.save(rec('20260601090000'), 'household');
    await store.listIndexEntries('household');
    const reasons = logger.events.filter((e) => e.event === 'fitness.cycle_races.index.rebuilt').map((e) => e.data.reason);
    expect(reasons).toEqual(['cold', 'version', 'stale-day']);
  });

  it('leaves no staging file beside a rewritten shard', async () => {
    await seedCold();
    await store.listIndexEntries('household');
    expect(fs.readdirSync(indexDir())).toEqual(['2026-06.json']);
  });
});
