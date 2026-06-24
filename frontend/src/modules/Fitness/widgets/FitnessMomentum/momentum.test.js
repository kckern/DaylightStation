// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js
import { describe, it, expect } from 'vitest';
import { computeMomentum, addDays } from './momentum.js';

const roster = [
  { id: 'felix', name: 'Felix' },
  { id: 'kckern', name: 'KC Kern' },
];
// "today" anchor used across tests
const TODAY = '2026-06-24';
const NOW = Date.UTC(2026, 5, 24, 18, 0, 0); // 2026-06-24T18:00Z

// helper to build a session
const sess = (date, durationMs, users, startTime) => ({
  date, durationMs, startTime: startTime ?? Date.parse(`${date}T12:00:00Z`),
  participants: Object.fromEntries(users.map((u) => [u, { displayName: u }])),
});

describe('addDays', () => {
  it('subtracts/adds days across month boundaries', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(addDays('2026-06-24', 1)).toBe('2026-06-25');
  });
});

describe('computeMomentum', () => {
  it('sums active minutes per participant over the rolling 7 days only', () => {
    const sessions = [
      sess('2026-06-24', 30 * 60000, ['felix']),          // in week
      sess('2026-06-20', 20 * 60000, ['felix', 'kckern']), // in week (both)
      sess('2026-06-10', 99 * 60000, ['felix']),          // OUTSIDE 7d window
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150 });
    const felix = members.find((m) => m.id === 'felix');
    const kc = members.find((m) => m.id === 'kckern');
    expect(felix.activeMinutes).toBe(50);   // 30 + 20, NOT the 99 from 14d ago
    expect(kc.activeMinutes).toBe(20);
    expect(felix.goalMinutes).toBe(150);
    expect(felix.pct).toBeCloseTo(50 / 150, 5);
    expect(felix.met).toBe(false);
  });

  it('counts a live streak through today or yesterday and stops at the first gap', () => {
    const sessions = [
      sess('2026-06-24', 10 * 60000, ['felix']),
      sess('2026-06-23', 10 * 60000, ['felix']),
      sess('2026-06-22', 10 * 60000, ['felix']),
      // gap on 06-21
      sess('2026-06-20', 10 * 60000, ['felix']),
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY });
    expect(members.find((m) => m.id === 'felix').streakDays).toBe(3);
  });

  it('keeps a streak alive when today is empty but yesterday is active', () => {
    const sessions = [
      sess('2026-06-23', 10 * 60000, ['felix']),
      sess('2026-06-22', 10 * 60000, ['felix']),
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY });
    expect(members.find((m) => m.id === 'felix').streakDays).toBe(2);
  });

  it('reports zero for a roster member with no sessions, but still lists them', () => {
    const { members } = computeMomentum([], roster, { now: NOW, todayStr: TODAY });
    expect(members.map((m) => m.id)).toEqual(['felix', 'kckern']); // roster order preserved
    expect(members[0].activeMinutes).toBe(0);
    expect(members[0].streakDays).toBe(0);
  });

  it('aggregates the household: minutes = sum of members, goal = members*goal, streak = any-member days', () => {
    const sessions = [
      sess('2026-06-24', 30 * 60000, ['felix']),
      sess('2026-06-23', 40 * 60000, ['kckern']),
    ];
    const { household } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150, householdLabel: 'Kern Family' });
    expect(household.label).toBe('Kern Family');
    expect(household.activeMinutes).toBe(70);     // 30 + 40
    expect(household.goalMinutes).toBe(300);      // 2 members * 150
    expect(household.streakDays).toBe(2);         // 06-24 + 06-23, any member
  });

  it('caps pct at 1 but keeps real minutes; flags met', () => {
    const sessions = [sess('2026-06-24', 200 * 60000, ['felix'])];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150 });
    const felix = members.find((m) => m.id === 'felix');
    expect(felix.activeMinutes).toBe(200);
    expect(felix.pct).toBe(1);
    expect(felix.met).toBe(true);
  });

  it('falls back to a generic household label and empty roster safely', () => {
    const { household, members } = computeMomentum([], [], { now: NOW, todayStr: TODAY });
    expect(household.label).toBe('Your household');
    expect(members).toEqual([]);
    expect(household.streakDays).toBe(0);
  });
});
