import { describe, it, expect } from 'vitest';
import { SchoolDebriefProgramLauncher } from './SchoolDebriefProgramLauncher.mjs';
import { DEFAULT_DAY_OFF_POLICY } from '../domain/dayOffPolicy.mjs';

// 2026-11-23 Mon .. 2026-11-25 Wed; Wednesday is a stay-home day.
const household = { except: [{ from: '2026-11-25', to: '2026-11-25', label: 'Thanksgiving break', tier: 'stay-home' }] };
const launcher = (dayOffPolicy, enrollment = {}) => new SchoolDebriefProgramLauncher({
  debriefs: { read: async () => ({ status: 'missing', events: [] }) },
  assignments: { get: async () => ({ programs: [{ programId: 'school-debrief', subject: 'writing', schedule: { daysOfWeek: [1, 2, 3, 4, 5] }, ...enrollment }] }) },
  householdSchedule: () => household,
  dayOffPolicy,
  timezone: 'America/Los_Angeles',
  clock: () => new Date('2026-11-26T20:00:00Z'),
  logger: {},
});
const range = { from: '2026-11-23', to: '2026-11-25' };

describe('debrief owed days follow the day-off keep-list', () => {
  it('default keep-lists excuse the debrief on a stay-home day (unchanged behaviour)', async () => {
    expect(await launcher(() => DEFAULT_DAY_OFF_POLICY).owedDays('kid', range)).toEqual(['2026-11-23', '2026-11-24']);
  });
  it('a keep-list that names the debrief makes the stay-home day owed', async () => {
    const policy = { ...DEFAULT_DAY_OFF_POLICY, 'stay-home': { keep: [{ program: 'school-debrief' }] } };
    expect(await launcher(() => policy).owedDays('kid', range)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
  });
  it('a subject keep-list matches the debrief\'s default subject when the enrollment names none', async () => {
    const policy = { ...DEFAULT_DAY_OFF_POLICY, 'stay-home': { keep: [{ subject: 'writing' }] } };
    expect(await launcher(() => policy, { subject: undefined }).owedDays('kid', range)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
  });
});
