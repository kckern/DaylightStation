import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CycleRaceService } from "./CycleRaceService.mjs";
import { YamlCycleRaceDatastore } from "../../adapters/persistence/YamlCycleRaceDatastore.mjs";

describe('CycleRaceService', () => {
  it('requires a datastore', () => {
    expect(() => new CycleRaceService({})).toThrow(/requires datastore/);
  });

  it('refuses to save a zero-distance race', async () => {
    const saved = [];
    const svc = new CycleRaceService({ datastore: { save: (r) => saved.push(r) } });
    const dead = { version: 1, race: { id: '20260602143012' }, participants: { user_3: { final_distance_m: 0 } } };
    expect(svc.save(dead, 'default')).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('saves a race with real distance', async () => {
    const saved = [];
    const svc = new CycleRaceService({ datastore: { save: (r) => { saved.push(r); return r; } } });
    const rec = { version: 1, race: { id: '20260602143012' }, participants: { user_3: { final_distance_m: 3000 } } };
    expect(svc.save(rec, 'default')).toEqual(rec);
    expect(saved).toHaveLength(1);
  });
});

describe('ladder + personal bests', () => {
  const CFG = { featured_courses: [
    { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
    { id: 'endurance-5min', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 }
  ] };
  const ENTRIES = [
    { id: '20260629080000', date: '2026-06-29', course_id: 'sprint-1500m', win_condition: 'distance', goal_m: 1500, time_cap_s: null,
      participants: [{ userId: 'dad', isGhost: false, final_time_s: 150, final_distance_m: 1500, placement: 1 }] },
    { id: '20260101080000', date: '2026-01-01', course_id: 'sprint-1500m', win_condition: 'distance', goal_m: 1500, time_cap_s: null,
      participants: [{ userId: 'user_3', isGhost: false, final_time_s: 140, final_distance_m: 1500, placement: 1 }] }
  ];
  const makeSvc = () => new CycleRaceService({ datastore: {
    listIndexEntries: async () => ENTRIES.map((e) => ({ ...e }))
  } });

  it('getLadder computes standings for the requested week and all-time record', async () => {
    const l = await makeSvc().getLadder({ cycleGameConfig: { ...CFG, featured_course_override: 'sprint-1500m' },
      week: '2026-W27', householdId: 'household' });
    expect(l.course.id).toBe('sprint-1500m');
    expect(l.standings).toEqual([{ userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 }]);
    expect(l.allTimeRecord.userId).toBe('user_3');
  });

  it('getLadder returns null with no featured courses; throws BAD_WEEK on garbage', async () => {
    expect(await makeSvc().getLadder({ cycleGameConfig: {}, householdId: 'h' })).toBeNull();
    await expect(makeSvc().getLadder({ cycleGameConfig: CFG, week: 'garbage', householdId: 'h' }))
      .rejects.toMatchObject({ code: 'BAD_WEEK' });
  });

  it('getPersonalBest resolves the course from config, or infers it from indexed entries', async () => {
    const withCfg = await makeSvc().getPersonalBest({ cycleGameConfig: CFG, userId: 'user_3', courseId: 'sprint-1500m', householdId: 'h' });
    expect(withCfg.best).toEqual({ bestValue: 140, raceId: '20260101080000', date: '2026-01-01' });
    const noCfg = await makeSvc().getPersonalBest({ cycleGameConfig: {}, userId: 'user_3', courseId: 'sprint-1500m', householdId: 'h' });
    expect(noCfg.best?.bestValue).toBe(140);
  });
});

describe('rival pool', () => {
  const ROWS = [
    { id: '20260101100000', date: '2026-01-01', course_id: null, win_condition: 'distance', goal_m: 3000, time_cap_s: null, incomplete: false,
      participants: [{ userId: 'rider-a', isGhost: false, stopped: false, final_time_s: 300, final_distance_m: 3000, placement: 1 }] },
    { id: '20260102100000', date: '2026-01-02', course_id: null, win_condition: 'distance', goal_m: 3000, time_cap_s: null, incomplete: true,
      participants: [{ userId: 'rider-a', isGhost: false, stopped: false, final_time_s: 100, final_distance_m: 3000, placement: 1 }] },
    { id: '20260103100000', date: '2026-01-03', course_id: null, win_condition: 'time', goal_m: null, time_cap_s: 300, incomplete: false,
      participants: [{ userId: 'rider-b', isGhost: false, stopped: true, final_time_s: null, final_distance_m: 2100, placement: 1 }] }
  ];
  const makeSvc = (calls = []) => new CycleRaceService({ datastore: {
    listIndexEntries: async (householdId) => { calls.push(householdId); return ROWS.map((e) => ({ ...e })); },
    findByDate: async () => { throw new Error('race files must not be read'); },
    listDates: async () => { throw new Error('race folders must not be listed'); }
  } });

  it('lists the index rows of one race type and exact length, from the index alone', async () => {
    const calls = [];
    const pool = await makeSvc(calls).getRivalPool({ winCondition: 'distance', goalM: '3000', householdId: 'household' });
    expect(pool).toEqual([{
      raceId: '20260101100000', date: '2026-01-01', winCondition: 'distance', goalM: 3000,
      participants: [{ id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 3000, placement: 1 }]
    }]);
    expect(calls).toEqual(['household']);
  });

  it('lists a time race by its cap', async () => {
    const pool = await makeSvc().getRivalPool({ winCondition: 'time', timeCapS: 300, householdId: 'household' });
    expect(pool.map((e) => e.raceId)).toEqual(['20260103100000']);
    expect(pool[0].participants[0].stopped).toBe(true);
  });

  it('throws BAD_RIVAL_POOL_QUERY for an unknown race type or an unusable length, without reading the index', async () => {
    const calls = [];
    const svc = makeSvc(calls);
    await expect(svc.getRivalPool({ winCondition: 'sprint', goalM: 3000 })).rejects.toMatchObject({ code: 'BAD_RIVAL_POOL_QUERY' });
    await expect(svc.getRivalPool({ winCondition: 'distance', goalM: 'abc' })).rejects.toMatchObject({ code: 'BAD_RIVAL_POOL_QUERY' });
    await expect(svc.getRivalPool({ winCondition: 'time', timeCapS: 0 })).rejects.toMatchObject({ code: 'BAD_RIVAL_POOL_QUERY' });
    expect(calls).toEqual([]);
  });
});

describe('warmIndex', () => {
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true }); });
  const makeLogger = () => {
    const events = [];
    const at = (level) => (event, data) => events.push({ level, event, data });
    return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  };
  const raceRecord = (id) => ({ version: 1, race: { id, win_condition: 'distance', goal_m: 1500 },
    participants: { 'rider-a': { final_distance_m: 1500, final_time_s: 150, placement: 1 } } });

  it('builds the shards, so the listing that follows reads no race file', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cgrace-warm-'));
    tmpDirs.push(base);
    const datastore = new YamlCycleRaceDatastore({ configService: { getHouseholdPath: (rel) => path.join(base, rel) } });
    const svc = new CycleRaceService({ datastore, logger: makeLogger() });
    await svc.save(raceRecord('20260601080000'), 'household');
    await svc.save(raceRecord('20260702080000'), 'household');

    await expect(svc.warmIndex('household')).resolves.toBeUndefined();

    expect(fs.readdirSync(path.join(base, 'fitness/log/cycle-races/_index')).sort()).toEqual(['2026-06.json', '2026-07.json']);
    const reads = vi.spyOn(datastore, 'findByDate');
    const entries = await svc.listIndexEntries('household');
    expect(entries.map((e) => e.id)).toEqual(['20260601080000', '20260702080000']);
    expect(reads).not.toHaveBeenCalled();
  });

  it('logs and swallows a failure', async () => {
    const logger = makeLogger();
    const svc = new CycleRaceService({ logger, datastore: { listIndexEntries: async () => { throw new Error('disk gone'); } } });
    await expect(svc.warmIndex('household')).resolves.toBeUndefined();
    expect(logger.events).toEqual([
      { level: 'warn', event: 'fitness.cycle_races.index.warm_failed', data: { error: 'disk gone' } }
    ]);
  });

  it('swallows a datastore that throws synchronously, and works without a logger', async () => {
    const svc = new CycleRaceService({ datastore: { listIndexEntries: () => { throw new Error('boom'); } } });
    await expect(svc.warmIndex('household')).resolves.toBeUndefined();
  });
});
