import { describe, it, expect } from 'vitest';
import { parseRivalPoolQuery, rivalPoolEntries } from "./cycleRivalPool.mjs";

const row = (id, over = {}, participants = null) => ({
  id, date: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`, course_id: null,
  win_condition: 'distance', goal_m: 3000, time_cap_s: null, incomplete: false,
  participants: participants || [
    { userId: 'rider-a', isGhost: false, stopped: false, final_time_s: 300, final_distance_m: 3000, placement: 1 }
  ],
  ...over
});

describe('parseRivalPoolQuery', () => {
  it('reads a distance or a time race, taking the length as a number', () => {
    expect(parseRivalPoolQuery({ winCondition: 'distance', goalM: '3000' })).toEqual({ winCondition: 'distance', length: 3000 });
    expect(parseRivalPoolQuery({ winCondition: 'time', timeCapS: 300 })).toEqual({ winCondition: 'time', length: 300 });
    expect(parseRivalPoolQuery({ winCondition: 'distance', goalM: '1609.3' })).toEqual({ winCondition: 'distance', length: 1609.3 });
  });

  it('reads only the length that belongs to the race type', () => {
    expect(parseRivalPoolQuery({ winCondition: 'time', goalM: '3000' })).toBeNull();
    expect(parseRivalPoolQuery({ winCondition: 'distance', timeCapS: '300' })).toBeNull();
  });

  it('is null for a missing or unknown race type', () => {
    expect(parseRivalPoolQuery({ goalM: '3000' })).toBeNull();
    expect(parseRivalPoolQuery({ winCondition: 'sprint', goalM: '3000' })).toBeNull();
    expect(parseRivalPoolQuery()).toBeNull();
  });

  it.each([undefined, null, '', ' ', '0', '-5', 'abc', '3000m', 'Infinity', ['3000', '1500'], true])(
    'is null for the length %j', (goalM) => {
      expect(parseRivalPoolQuery({ winCondition: 'distance', goalM })).toBeNull();
    }
  );
});

describe('rivalPoolEntries', () => {
  it('keeps rows of the same race type and exact length, in the shape the client picks from', () => {
    const entries = [
      row('20260101100000', { course_id: 'sprint' }, [
        { userId: 'rider-a', isGhost: false, stopped: false, final_time_s: 300, final_distance_m: 3000, placement: 1 },
        { userId: 'ghost:20250101100000:rider-b', isGhost: true, stopped: false, final_time_s: null, final_distance_m: 2900, placement: 2 },
        { userId: 'rider-c', isGhost: false, stopped: true, final_time_s: null, final_distance_m: 1200, placement: 3 }
      ]),
      row('20260102100000', { goal_m: 1500 }),
      row('20260103100000', { win_condition: 'time', goal_m: null, time_cap_s: 3000 })
    ];
    expect(rivalPoolEntries({ entries, winCondition: 'distance', length: 3000 })).toEqual([{
      raceId: '20260101100000', date: '2026-01-01', winCondition: 'distance', goalM: 3000,
      participants: [
        { id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 3000, placement: 1 },
        { id: 'ghost:20250101100000:rider-b', isGhost: true, stopped: false, finalTimeS: null, finalDistanceM: 2900, placement: 2 },
        { id: 'rider-c', isGhost: false, stopped: true, finalTimeS: null, finalDistanceM: 1200, placement: 3 }
      ]
    }]);
  });

  it('a time race carries timeCapS and no goalM', () => {
    const entries = [row('20260103100000', { win_condition: 'time', goal_m: null, time_cap_s: 300 })];
    const [e] = rivalPoolEntries({ entries, winCondition: 'time', length: 300 });
    expect(e).toMatchObject({ raceId: '20260103100000', winCondition: 'time', timeCapS: 300 });
    expect(e).not.toHaveProperty('goalM');
  });

  it('leaves out races that were ended early', () => {
    const entries = [row('20260101100000', { incomplete: true }), row('20260102100000')];
    expect(rivalPoolEntries({ entries, winCondition: 'distance', length: 3000 }).map((e) => e.raceId))
      .toEqual(['20260102100000']);
  });

  it('compares lengths as numbers and never matches a row with no length', () => {
    const entries = [row('20260101100000', { goal_m: '3000' }), row('20260102100000', { goal_m: null }), row('20260103100000', { goal_m: 3000.5 })];
    expect(rivalPoolEntries({ entries, winCondition: 'distance', length: 3000 }).map((e) => e.raceId))
      .toEqual(['20260101100000']);
  });

  it('is empty for no rows, an unknown race type or a length that is not positive', () => {
    expect(rivalPoolEntries({ entries: null, winCondition: 'distance', length: 3000 })).toEqual([]);
    expect(rivalPoolEntries({ entries: [row('20260101100000')], winCondition: 'sprint', length: 3000 })).toEqual([]);
    expect(rivalPoolEntries({ entries: [row('20260101100000', { goal_m: 0 })], winCondition: 'distance', length: 0 })).toEqual([]);
    expect(rivalPoolEntries()).toEqual([]);
  });

  it('tolerates a row with no participants list', () => {
    const [e] = rivalPoolEntries({ entries: [row('20260101100000', { participants: undefined })], winCondition: 'distance', length: 3000 });
    expect(e.participants).toEqual([]);
  });
});
