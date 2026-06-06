import { describe, it, expect } from 'vitest';
import { CycleGameProvider, raceEpochMs } from './CycleGameProvider.mjs';

const race = (id, utcIso, riders) => ({
  race: { id, date: utcIso, time_cap_s: 60, background_plex_id: 674141 },
  participants: Object.fromEntries(riders.map(([n, d], i) =>
    [n, { display_name: n, final_distance_m: d, placement: i + 1 }])),
});

const svc = {
  listByDate: async () => [
    race('r-morning', '2026-06-05T15:48:00Z', [['kckern', 0], ['felix', 0]]), // 08:48 PDT
    race('r-after',   '2026-06-05T23:22:37Z', [['milo', 215], ['alan', 222]]),// 16:22 PDT
  ],
};

describe('raceEpochMs', () => {
  it('parses the UTC race.date string to epoch ms', () => {
    expect(raceEpochMs({ race: { date: '2026-06-05T23:22:37Z' } }))
      .toBe(Date.parse('2026-06-05T23:22:37Z'));
  });
  it('returns null for missing/invalid date', () => {
    expect(raceEpochMs({ race: {} })).toBeNull();
    expect(raceEpochMs(null)).toBeNull();
    expect(raceEpochMs({ race: { date: 'not-a-date' } })).toBeNull();
  });
});

describe('CycleGameProvider', () => {
  it('parses UTC race.date to epoch and filters to the window', async () => {
    const p = new CycleGameProvider({ cycleRaceService: svc });
    const start = Date.parse('2026-06-05T16:22:00-07:00');
    const end   = Date.parse('2026-06-05T16:59:00-07:00');
    const items = await p.loadOverlapping(start, end, '2026-06-05', 'household');
    expect(items.map(i => i.meta.raceId)).toEqual(['r-after']); // morning excluded
    expect(items[0].startMs).toBe(Date.parse('2026-06-05T23:22:37Z'));
    expect(items[0].endMs).toBe(Date.parse('2026-06-05T23:22:37Z') + 60000);
    expect(items[0].meta.winnerId).toBe('milo');               // placement 1
    expect(items[0].meta.distances).toEqual({ milo: 215, alan: 222 });
    expect(items[0].meta.backgroundPlexId).toBe(674141);
    expect(items[0].participants.sort()).toEqual(['alan', 'milo']);
  });

  it('allows a small slack at the window edges and sorts by startMs', async () => {
    const p = new CycleGameProvider({ cycleRaceService: svc });
    // window that ends exactly when r-after starts minus 30s -> still included via slack
    const start = Date.parse('2026-06-05T23:00:00Z');
    const end   = Date.parse('2026-06-05T23:22:07Z'); // 30s before r-after; within 90s slack
    const items = await p.loadOverlapping(start, end, '2026-06-05', 'household');
    expect(items.map(i => i.meta.raceId)).toEqual(['r-after']);
  });

  it('returns [] when the service yields nothing', async () => {
    const p = new CycleGameProvider({ cycleRaceService: { listByDate: async () => [] } });
    expect(await p.loadOverlapping(0, 1, '2026-06-05', 'h')).toEqual([]);
  });

  it('throws if constructed without cycleRaceService', () => {
    expect(() => new CycleGameProvider({})).toThrow();
  });

  it('excludes ghost participants and never names a ghost as winner', async () => {
    const ghostRace = {
      race: { id: 'g1', date: '2026-06-05T23:29:22Z', time_cap_s: 120, background_plex_id: 674141 },
      participants: {
        milo: { display_name: 'Milo', final_distance_m: 613, placement: 2 },
        'ghost:abc:milo': { display_name: 'Ghost', final_distance_m: 1360, placement: 1 },
        'ghost:abc:alan': { display_name: 'Ghost', final_distance_m: 1317, placement: 3 },
      },
    };
    const p = new CycleGameProvider({ cycleRaceService: { listByDate: async () => [ghostRace] } });
    const [item] = await p.loadOverlapping(
      Date.parse('2026-06-05T23:00:00Z'), Date.parse('2026-06-05T23:59:00Z'), '2026-06-05', 'h');
    expect(item.participants).toEqual(['milo']);          // ghosts removed
    expect(item.meta.winnerId).toBe('milo');              // not the ghost despite its placement 1
    expect(item.meta.distances).toEqual({ milo: 613 });   // ghosts excluded from distances
  });

  it('uses ACTUAL finish time (not the time cap) for a distance-race band so races dont nest', async () => {
    // distance race won in 13s but cap is 180s — band must be 13s wide, else it swallows
    // the next race (the "race within race" bug).
    const distRace = {
      race: { id: 'd1', date: '2026-06-05T23:44:18Z', time_cap_s: 180, win_condition: 'distance', interval_seconds: 1 },
      participants: { milo: { display_name: 'Milo', final_distance_m: 1000, final_time_s: 13, placement: 1 } },
    };
    const p = new CycleGameProvider({ cycleRaceService: { listByDate: async () => [distRace] } });
    const [item] = await p.loadOverlapping(0, Date.parse('2026-06-06T00:00:00Z'), '2026-06-05', 'h');
    expect((item.endMs - item.startMs) / 1000).toBe(13);
  });

  it('uses the recorded series length for an abandoned time race (not the cap)', async () => {
    // a 180s time race that everyone quit after ~13s recorded only ~14 samples — the band
    // must be ~13s, not 180s, so it does not swallow the next race.
    const abandoned = {
      race: { id: 't1', date: '2026-06-05T23:44:18Z', time_cap_s: 180, win_condition: 'time', interval_seconds: 1 },
      participants: {
        alan: { display_name: 'Alan', final_distance_m: 94, final_time_s: null, placement: 1,
                distance_series: JSON.stringify([[0, 2], 4, 8, 12, 16, 20, 30, 40, 50, 60, 70, 80, 94]) }, // 14 ticks
        felix: { display_name: 'Felix', final_distance_m: 0, distance_series: JSON.stringify([0]) },
      },
    };
    const p = new CycleGameProvider({ cycleRaceService: { listByDate: async () => [abandoned] } });
    const [item] = await p.loadOverlapping(0, Date.parse('2026-06-06T00:00:00Z'), '2026-06-05', 'h');
    expect((item.endMs - item.startMs) / 1000).toBe(13); // (14 ticks - 1) * 1s, not 180
  });

  it('falls back to the time cap only when there is no recorded data', async () => {
    const timeRace = {
      race: { id: 't2', date: '2026-06-05T23:55:57Z', time_cap_s: 120, win_condition: 'time', interval_seconds: 1 },
      participants: { milo: { display_name: 'Milo', final_distance_m: 300, final_time_s: null, placement: 1 } },
    };
    const p = new CycleGameProvider({ cycleRaceService: { listByDate: async () => [timeRace] } });
    const [item] = await p.loadOverlapping(0, Date.parse('2026-06-06T00:00:00Z'), '2026-06-05', 'h');
    expect((item.endMs - item.startMs) / 1000).toBe(120);
  });
});
