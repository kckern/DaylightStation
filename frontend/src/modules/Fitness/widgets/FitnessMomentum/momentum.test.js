import { describe, it, expect } from 'vitest';
import { computeMomentum, mondayWeekStart } from './momentum.js';

const roster = [
  { id: 'user_2', name: 'User_2' },
  { id: 'user_1', name: 'User_1' },
];

const localMs = (date, hour = 12) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
};
const NOW = localMs('2026-06-24', 18); // Wednesday

const session = (date, rings, zoneMinutes, users = ['user_2'], extras = {}) => ({
  startTime: localMs(date),
  totalRings: rings * users.length,
  participants: Object.fromEntries(users.map((id) => [id, {
    displayName: id,
    rings,
    zoneMinutes,
  }])),
  ...extras,
});

describe('mondayWeekStart', () => {
  it('anchors an ordinary day to Monday at the 04:00 study-day boundary', () => {
    expect(mondayWeekStart(NOW)).toBe(localMs('2026-06-22', 4));
  });

  it('keeps early Monday in the week that ended Sunday', () => {
    expect(mondayWeekStart(localMs('2026-08-31', 3))).toBe(localMs('2026-08-24', 4));
    expect(mondayWeekStart(localMs('2026-08-31', 5))).toBe(localMs('2026-08-31', 4));
  });
});

describe('computeMomentum — rings and zone contribution', () => {
  it('uses exact persisted rings and omits cool from the colored contribution', () => {
    const row = computeMomentum([
      session('2026-06-24', 100, { active: 16, warm: 8, cool: 9, hot: 1, fire: 0 }),
    ], roster, { now: NOW }).members.find((member) => member.id === 'user_2');
    const current = row.weeks.at(-1);
    expect(current.rings).toBe(100);
    expect(row.rings).toBe(100);
    expect(current.zones.active + current.zones.warm + current.zones.hot + current.zones.fire)
      .toBeCloseTo(100, 5);
  });

  it('uses configured relative award rates for the color bands', () => {
    const row = computeMomentum([
      session('2026-06-24', 90, { active: 10, warm: 10 }),
    ], roster, { now: NOW, zoneRingRates: { active: 1, warm: 2, hot: 3, fire: 5 } })
      .members.find((member) => member.id === 'user_2');
    expect(row.weeks.at(-1).zones.active).toBeCloseTo(30, 5);
    expect(row.weeks.at(-1).zones.warm).toBeCloseTo(60, 5);
  });

  it('recovers a legacy single-person session from its unambiguous session total', () => {
    const legacy = session('2026-06-24', 75, { active: 10 });
    delete legacy.participants.user_2.rings;
    const row = computeMomentum([legacy], roster, { now: NOW }).members[0];
    expect(row.rings).toBe(75);
  });
});

describe('computeMomentum — fixed calendar weeks', () => {
  it('returns Monday-aligned buckets oldest→newest, current flagged last', () => {
    const row = computeMomentum([], roster, { now: NOW, compareWeeks: 4 }).members[0];
    expect(row.weeks).toHaveLength(4);
    expect(row.weeks.map((week) => week.startMs)).toEqual([
      localMs('2026-06-01', 4),
      localMs('2026-06-08', 4),
      localMs('2026-06-15', 4),
      localMs('2026-06-22', 4),
    ]);
    expect(row.weeks[3].current).toBe(true);
    expect(row.weeks.every((week) => week.rings === 0)).toBe(true);
  });

  it('buckets rings into calendar weeks instead of rolling seven-day windows', () => {
    const sessions = [
      session('2026-06-24', 20, { active: 10 }), // current week
      session('2026-06-23', 30, { active: 10 }), // current week
      session('2026-06-19', 40, { warm: 10 }),   // previous week
      session('2026-06-12', 50, { hot: 10 }),    // two weeks back
      session('2026-06-05', 60, { fire: 10 }),   // three weeks back
      session('2026-05-29', 99, { active: 10 }), // outside four weeks
    ];
    const row = computeMomentum(sessions, roster, { now: NOW, compareWeeks: 4 }).members[0];
    expect(row.weeks.map((week) => week.rings)).toEqual([60, 50, 40, 50]);
  });

  it('resets on Monday even when Sunday is less than 24 hours old', () => {
    const mondayNow = localMs('2026-08-31', 12);
    const row = computeMomentum([
      session('2026-08-30', 99, { active: 10 }),
      session('2026-08-31', 7, { active: 10 }),
    ], roster, { now: mondayNow, compareWeeks: 2 }).members[0];
    expect(row.weeks.map((week) => week.rings)).toEqual([99, 7]);
  });
});

describe('computeMomentum — household + edges', () => {
  it('sums member weekly rings and zone bands position-by-position', () => {
    const sessions = [
      session('2026-06-24', 30, { active: 10 }, ['user_2']),
      session('2026-06-23', 50, { warm: 10 }, ['user_1']),
      session('2026-06-19', 25, { hot: 10 }, ['user_2']),
    ];
    const { household } = computeMomentum(sessions, roster, {
      now: NOW,
      householdLabel: 'Kern Family',
    });
    expect(household.label).toBe('Kern Family');
    expect(household.weeks).toHaveLength(4);
    expect(household.weeks[3].rings).toBe(80);
    expect(household.weeks[2].rings).toBe(25);
    expect(household.rings).toBe(80);
    expect(household.compareWeeks).toBe(4);
  });

  it('lists roster members in order even with no sessions', () => {
    const { members } = computeMomentum([], roster, { now: NOW });
    expect(members.map((member) => member.id)).toEqual(['user_2', 'user_1']);
  });

  it('falls back to a generic household label and empty roster safely', () => {
    const { household, members } = computeMomentum([], [], { now: NOW });
    expect(household.label).toBe('Your household');
    expect(members).toEqual([]);
    expect(household.rings).toBe(0);
  });
});
