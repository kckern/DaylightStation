// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js
import { describe, it, expect } from 'vitest';
import { computeMomentum, addDays } from './momentum.js';

const roster = [
  { id: 'felix', name: 'Felix' },
  { id: 'kckern', name: 'KC Kern' },
];
const NOW = Date.UTC(2026, 5, 24, 18, 0, 0); // 2026-06-24T18:00Z

// Session with per-zone minutes. Default window is 7 days; baseline = prior 4 windows.
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
  it('credits active/warm/hot/fire and OMITS cool', () => {
    const sessions = [zsess('2026-06-24', { active: 16, warm: 8, cool: 9, hot: 1, fire: 0 })];
    const { members } = computeMomentum(sessions, roster, { now: NOW });
    const felix = members.find((m) => m.id === 'felix');
    expect(felix.zones).toEqual({ active: 16, warm: 8, hot: 1, fire: 0 });
    expect(felix.effortMinutes).toBe(25); // 16+8+1, the 9 cool minutes earn no credit
  });

  it('only counts sessions inside the current window', () => {
    const sessions = [
      zsess('2026-06-24', { active: 30 }),  // in window
      zsess('2026-06-10', { active: 99 }),  // 14d ago — outside default 7d window
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW });
    expect(members.find((m) => m.id === 'felix').effortMinutes).toBe(30);
  });

  it('respects a configurable window length', () => {
    const sessions = [zsess('2026-06-12', { active: 30 })]; // 12 days ago
    expect(computeMomentum(sessions, roster, { now: NOW }).members[0].effortMinutes).toBe(0);
    expect(computeMomentum(sessions, roster, { now: NOW, windowDays: 14 }).members[0].effortMinutes).toBe(30);
  });

  it('falls back to raw duration when a session has no zone breakdown', () => {
    const sessions = [zsess('2026-06-24', null, ['felix'], 30 * 60000)];
    const felix = computeMomentum(sessions, roster, { now: NOW }).members.find((m) => m.id === 'felix');
    expect(felix.effortMinutes).toBe(30);
    expect(felix.zones.active).toBe(30); // attributed to active so it still renders
  });
});

describe('computeMomentum — baseline comparison', () => {
  it('denominator is the average effort over the prior 4 windows', () => {
    const sessions = [
      // baseline span (prior 4 weeks): 40 credited min each → total 160 → avg 40
      zsess('2026-05-25', { active: 40 }),
      zsess('2026-06-01', { active: 40 }),
      zsess('2026-06-08', { active: 40 }),
      zsess('2026-06-15', { active: 40 }),
      // current window: 20 min
      zsess('2026-06-20', { active: 20 }),
    ];
    const felix = computeMomentum(sessions, roster, { now: NOW }).members.find((m) => m.id === 'felix');
    expect(felix.baselineMinutes).toBe(40);
    expect(felix.effortMinutes).toBe(20);
    expect(felix.pct).toBeCloseTo(0.5, 5);
    expect(felix.ratioPct).toBe(50);
    expect(felix.ahead).toBe(false);
  });

  it('flags ahead and reports a >100% ratio when beating the baseline', () => {
    const sessions = [
      zsess('2026-05-25', { active: 10 }),
      zsess('2026-06-01', { active: 10 }),
      zsess('2026-06-08', { active: 10 }),
      zsess('2026-06-15', { active: 10 }),
      zsess('2026-06-20', { active: 25 }),
    ];
    const felix = computeMomentum(sessions, roster, { now: NOW }).members.find((m) => m.id === 'felix');
    expect(felix.baselineMinutes).toBe(10);
    expect(felix.ratioPct).toBe(250);
    expect(felix.ahead).toBe(true);
  });

  it('with no baseline history, any effort reads as 100% (new momentum)', () => {
    const felix = computeMomentum([zsess('2026-06-24', { active: 25 })], roster, { now: NOW })
      .members.find((m) => m.id === 'felix');
    expect(felix.baselineMinutes).toBe(0);
    expect(felix.pct).toBe(1);
    expect(felix.ahead).toBe(true);
  });
});

describe('computeMomentum — household + edges', () => {
  it('aggregates members into a household total and label', () => {
    const sessions = [
      zsess('2026-06-24', { active: 30 }, ['felix']),
      zsess('2026-06-23', { active: 40, warm: 10 }, ['kckern']),
    ];
    const { household } = computeMomentum(sessions, roster, { now: NOW, householdLabel: 'Kern Family' });
    expect(household.label).toBe('Kern Family');
    expect(household.effortMinutes).toBe(80);            // 30 + 50
    expect(household.zones).toEqual({ active: 70, warm: 10, hot: 0, fire: 0 });
    expect(household.windowDays).toBe(7);
  });

  it('lists roster members with no sessions at zero, in order', () => {
    const { members } = computeMomentum([], roster, { now: NOW });
    expect(members.map((m) => m.id)).toEqual(['felix', 'kckern']);
    expect(members[0].effortMinutes).toBe(0);
    expect(members[0].zones).toEqual({ active: 0, warm: 0, hot: 0, fire: 0 });
  });

  it('falls back to a generic household label and empty roster safely', () => {
    const { household, members } = computeMomentum([], [], { now: NOW });
    expect(household.label).toBe('Your household');
    expect(members).toEqual([]);
    expect(household.effortMinutes).toBe(0);
  });
});
