// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js
import { describe, it, expect } from 'vitest';
import { computeMomentum, addDays } from './momentum.js';

const roster = [
  { id: 'felix', name: 'Felix' },
  { id: 'kckern', name: 'KC Kern' },
];
const NOW = Date.UTC(2026, 5, 24, 18, 0, 0); // 2026-06-24T18:00Z

// Session with per-zone minutes. Default window 7d, default 4 compared weeks.
const zsess = (date, zoneMinutes, users = ['felix'], durationMs = 0) => ({
  startTime: Date.parse(`${date}T12:00:00Z`),
  durationMs,
  participants: Object.fromEntries(users.map((u) => [u, { displayName: u, zoneMinutes }])),
});

describe('addDays', () => {
  it('subtracts/adds days across month boundaries', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(addDays('2026-06-24', 1)).toBe('2026-06-25');
  });
});

describe('computeMomentum — zone-weighted effort', () => {
  it('credits active/warm/hot/fire and OMITS cool in the current week', () => {
    const { members } = computeMomentum([zsess('2026-06-24', { active: 16, warm: 8, cool: 9, hot: 1, fire: 0 })], roster, { now: NOW });
    const felix = members.find((m) => m.id === 'felix');
    const cur = felix.weeks[felix.weeks.length - 1];
    expect(cur.zones).toEqual({ active: 16, warm: 8, hot: 1, fire: 0 });
    expect(cur.effortMinutes).toBe(25); // the 9 cool minutes earn no credit
    expect(felix.effortMinutes).toBe(25); // convenience: current-week total
  });

  it('falls back to raw duration when a session has no zone breakdown', () => {
    const felix = computeMomentum([zsess('2026-06-24', null, ['felix'], 30 * 60000)], roster, { now: NOW })
      .members.find((m) => m.id === 'felix');
    expect(felix.effortMinutes).toBe(30);
    expect(felix.weeks[felix.weeks.length - 1].zones.active).toBe(30);
  });
});

describe('computeMomentum — weekly buckets', () => {
  it('returns compareWeeks buckets oldest→newest, current flagged last', () => {
    const { members } = computeMomentum([], roster, { now: NOW, compareWeeks: 4 });
    const felix = members.find((m) => m.id === 'felix');
    expect(felix.weeks.length).toBe(4);
    expect(felix.weeks[3].current).toBe(true);
    expect(felix.weeks[0].current).toBe(false);
    expect(felix.weeks.every((w) => w.effortMinutes === 0)).toBe(true);
  });

  it('buckets effort into the correct week by age', () => {
    const sessions = [
      zsess('2026-06-24', { active: 20 }), // 0 days ago  → current week (idx 3)
      zsess('2026-06-19', { active: 30 }), // ~5 days ago → current week too (idx 3)
      zsess('2026-06-15', { active: 40 }), // ~9 days ago → 1 week back (idx 2)
      zsess('2026-06-05', { active: 50 }), // ~19 days ago → 2 weeks back (idx 1)
      zsess('2026-05-29', { active: 60 }), // ~26 days ago → 3 weeks back (idx 0)
      zsess('2026-05-20', { active: 99 }), // ~35 days ago → OUTSIDE 4-week span
    ];
    const felix = computeMomentum(sessions, roster, { now: NOW, compareWeeks: 4 }).members.find((m) => m.id === 'felix');
    expect(felix.weeks.map((w) => w.effortMinutes)).toEqual([60, 50, 40, 50]); // oldest→newest; current = 20+30
  });

  it('honors a configurable window length when bucketing', () => {
    const sessions = [zsess('2026-06-12', { active: 30 })]; // 12 days ago
    // default 7d window → 12 days ago lands in an older bucket, not current
    const def = computeMomentum(sessions, roster, { now: NOW }).members[0].weeks;
    expect(def[def.length - 1].effortMinutes).toBe(0); // not current week
    // 14d window → 12 days ago is the current window
    const wide = computeMomentum(sessions, roster, { now: NOW, windowDays: 14 }).members[0].weeks;
    expect(wide[wide.length - 1].effortMinutes).toBe(30);
  });
});

describe('computeMomentum — household + edges', () => {
  it('sums member weekly buckets position-by-position', () => {
    const sessions = [
      zsess('2026-06-24', { active: 30 }, ['felix']),       // current week
      zsess('2026-06-23', { active: 40, warm: 10 }, ['kckern']), // current week
      zsess('2026-06-15', { active: 25 }, ['felix']),       // 1 week back
    ];
    const { household } = computeMomentum(sessions, roster, { now: NOW, householdLabel: 'Kern Family' });
    expect(household.label).toBe('Kern Family');
    expect(household.weeks.length).toBe(4);
    expect(household.weeks[3].effortMinutes).toBe(80);  // current: 30 + 50
    expect(household.weeks[3].zones).toEqual({ active: 70, warm: 10, hot: 0, fire: 0 });
    expect(household.weeks[2].effortMinutes).toBe(25);  // one week back: felix 25
    expect(household.effortMinutes).toBe(80);
    expect(household.windowDays).toBe(7);
    expect(household.compareWeeks).toBe(4);
  });

  it('lists roster members in order even with no sessions', () => {
    const { members } = computeMomentum([], roster, { now: NOW });
    expect(members.map((m) => m.id)).toEqual(['felix', 'kckern']);
    expect(members[0].weeks.length).toBe(4);
  });

  it('falls back to a generic household label and empty roster safely', () => {
    const { household, members } = computeMomentum([], [], { now: NOW });
    expect(household.label).toBe('Your household');
    expect(members).toEqual([]);
    expect(household.effortMinutes).toBe(0);
  });
});
