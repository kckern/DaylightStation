import { describe, it, expect } from 'vitest';
import { YamlHealthDatastore } from './YamlHealthDatastore.mjs';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const dataService = () => {
  const store = { read: () => null, write: () => true };
  return { user: store, household: store, system: store };
};
const session = (id, date, participants, extra = {}) => ({
  sessionId: id, date, startTime: 1790370376000, durationMs: 1233000, timezone: 'America/Los_Angeles',
  participants, media: { primary: { showTitle: 'Game Cycling', title: 'Sonic & Sega All Stars Racing' } },
  stravaActivityId: null, ...extra,
});

describe('home Fitness sessions join the workout views', () => {
  const sessions = [
    session('a', '2026-09-25', { kc: { hrAvg: 107 }, 'test-learner': { hrAvg: 132 } }),
    session('b', '2026-09-25', { 'test-learner': { hrAvg: 140 } }), // kc was not in this one
    session('c', '2026-09-24', { kc: { hrAvg: null } }, { stravaActivityId: 99 }),
  ];
  const make = (homeSessionStore) => new YamlHealthDatastore({ dataService: dataService(), homeSessionStore, logger: quiet });

  it('lists only sessions the user took part in, with that participant\'s heart rate', async () => {
    const store = make({ findInRange: async (from, to) => sessions.filter((s) => s.date >= from && s.date <= to) });
    const day = await store.getWorkoutsForDate('kc', '2026-09-25');
    expect(day.home).toEqual([{ sessionId: 'a', segmentIds: [], startTime: 1790370376000, durationMs: 1233000,
      timezone: 'America/Los_Angeles', title: 'Game Cycling—Sonic & Sega All Stars Racing', stravaActivityId: null, avgHeartrate: 107 }]);
    const range = await store.getWorkoutsForRange('kc', '2026-09-24', '2026-09-25');
    expect(range['2026-09-24'].home).toMatchObject([{ sessionId: 'c', stravaActivityId: 99, avgHeartrate: null }]);
    expect(range['2026-09-25'].home.map((s) => s.sessionId)).toEqual(['a']);
  });

  it('an unreadable fitness store reads as no home sessions, not a failure', async () => {
    const store = make({ findInRange: async () => { throw new Error('boom'); } });
    expect((await store.getWorkoutsForDate('kc', '2026-09-25')).home).toEqual([]);
  });

  it('without a fitness store the views are unchanged', async () => {
    expect((await make(null).getWorkoutsForDate('kc', '2026-09-25')).home).toEqual([]);
  });
});
