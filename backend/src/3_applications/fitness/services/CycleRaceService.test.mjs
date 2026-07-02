import { describe, it, expect } from 'vitest';
import { CycleRaceService } from './CycleRaceService.mjs';

describe('CycleRaceService', () => {
  it('requires a datastore', () => {
    expect(() => new CycleRaceService({})).toThrow(/requires datastore/);
  });

  it('refuses to save a zero-distance race', async () => {
    const saved = [];
    const svc = new CycleRaceService({ datastore: { save: (r) => saved.push(r) } });
    const dead = { version: 1, race: { id: '20260602143012' }, participants: { milo: { final_distance_m: 0 } } };
    expect(svc.save(dead, 'default')).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('saves a race with real distance', async () => {
    const saved = [];
    const svc = new CycleRaceService({ datastore: { save: (r) => { saved.push(r); return r; } } });
    const rec = { version: 1, race: { id: '20260602143012' }, participants: { milo: { final_distance_m: 3000 } } };
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
      participants: [{ userId: 'milo', isGhost: false, final_time_s: 140, final_distance_m: 1500, placement: 1 }] }
  ];
  const makeSvc = () => new CycleRaceService({ datastore: {
    listIndexEntries: async () => ENTRIES.map((e) => ({ ...e }))
  } });

  it('getLadder computes standings for the requested week and all-time record', async () => {
    const l = await makeSvc().getLadder({ cycleGameConfig: { ...CFG, featured_course_override: 'sprint-1500m' },
      week: '2026-W27', householdId: 'household' });
    expect(l.course.id).toBe('sprint-1500m');
    expect(l.standings).toEqual([{ userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 }]);
    expect(l.allTimeRecord.userId).toBe('milo');
  });

  it('getLadder returns null with no featured courses; throws BAD_WEEK on garbage', async () => {
    expect(await makeSvc().getLadder({ cycleGameConfig: {}, householdId: 'h' })).toBeNull();
    await expect(makeSvc().getLadder({ cycleGameConfig: CFG, week: 'garbage', householdId: 'h' }))
      .rejects.toMatchObject({ code: 'BAD_WEEK' });
  });

  it('getPersonalBest resolves the course from config, or infers it from indexed entries', async () => {
    const withCfg = await makeSvc().getPersonalBest({ cycleGameConfig: CFG, userId: 'milo', courseId: 'sprint-1500m', householdId: 'h' });
    expect(withCfg.best).toEqual({ bestValue: 140, raceId: '20260101080000', date: '2026-01-01' });
    const noCfg = await makeSvc().getPersonalBest({ cycleGameConfig: {}, userId: 'milo', courseId: 'sprint-1500m', householdId: 'h' });
    expect(noCfg.best?.bestValue).toBe(140);
  });
});
