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
});
