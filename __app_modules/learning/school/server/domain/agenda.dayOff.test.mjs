import { describe, expect, it } from 'vitest';
import { planDailyAgenda } from "./agenda.mjs";

const base = { elective: false, status: 'available', timingPriority: 3, timingRank: 0 };
const scripture = { ...base, unitId: 'cfm-1', title: 'Psalms', subject: 'scripture', courseId: 'cfm', program: null };
const civ = { ...base, unitId: 'civ-1', title: 'States', subject: 'civilization', courseId: 'civ', program: null };
const hol = (over = {}) => ({
  ...base, unitId: 'hol', title: 'Veterans Day', subject: 'civilization', courseId: 'civ', program: null,
  dateBound: { onDays: [{ from: '2026-11-11', to: '2026-11-11' }] }, ...over,
});
const weekdays = { daysOfWeek: [1, 2, 3, 4, 5] };
const piano = { ...base, unitId: 'piano-course', subject: 'arts', program: 'piano-course', cadence: 'daily', schedule: weekdays };
const debrief = { ...base, unitId: 'school-debrief', subject: 'writing', program: 'school-debrief', cadence: 'daily', schedule: weekdays };
const shelf = { ...base, unitId: 'book-log:shelf', subject: 'english', program: 'book-log', programInstance: 'shelf', cadence: 'daily' };
const statuses = {
  'piano-course': { doneToday: false }, 'school-debrief': { doneToday: false }, 'book-log::shelf': { doneToday: false },
};

const cal = (span) => ({ except: [span] });
const build = ({ entries, day = '2026-11-11', householdSchedule, sessions = [] }) => planDailyAgenda({
  plan: { entries }, sessions, programStatuses: statuses, now: `${day}T18:00:00.000Z`, householdSchedule,
});
const section = (agenda, subject) => agenda.sections.find((s) => s.subject === subject);
const all = [scripture, civ, piano, debrief, shelf];

describe('day-off tiers on the agenda', () => {
  it('an untagged break excuses every section as household_calendar and names the day away', () => {
    const agenda = build({ entries: all, householdSchedule: cal({ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day' }) });
    agenda.sections.forEach((s) => expect(s.obligation).toEqual({ state: 'excused', reason: 'household_calendar' }));
    expect(agenda.dayOff).toEqual({ tier: 'away', label: 'Veterans Day' });
  });

  it('a stay-home Wednesday keeps scripture, piano and reading; excuses the debrief and civilization', () => {
    const agenda = build({ entries: all, householdSchedule: cal({ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'stay-home' }) });
    expect(section(agenda, 'scripture').obligation.state).toBe('obligated');
    expect(section(agenda, 'arts').obligation.state).toBe('obligated');
    expect(section(agenda, 'english').obligation.state).toBe('obligated');
    expect(section(agenda, 'writing').obligation).toEqual({ state: 'excused', reason: 'day_off' });
    expect(section(agenda, 'civilization').obligation).toEqual({ state: 'excused', reason: 'day_off' });
    expect(agenda.dayOff).toEqual({ tier: 'stay-home', label: 'Veterans Day' });
  });

  const enrichment = cal({ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'enrichment', replaces: 'civilization', assignment: 'hol' });

  it('an enrichment day swaps the subject for its date-bound unit', () => {
    const agenda = build({ entries: [...all, hol()], householdSchedule: enrichment });
    expect(section(agenda, 'civilization').next.unitId).toBe('hol');
    expect(section(agenda, 'civilization').obligation.state).toBe('obligated');
  });

  it('an enrichment day without its unit works as stay-home', () => {
    const agenda = build({ entries: all, householdSchedule: enrichment });
    expect(section(agenda, 'civilization').obligation).toEqual({ state: 'excused', reason: 'day_off' });
    expect(section(agenda, 'scripture').obligation.state).toBe('obligated');
  });

  it('a major holiday offers the date-bound scripture activity and excuses piano', () => {
    const special = { ...hol(), unitId: 'holiday-thanksgiving', subject: 'scripture', courseId: null, dateBound: { onDays: [{ from: '2026-11-26', to: '2026-11-26' }] } };
    const agenda = build({
      entries: [...all, special], day: '2026-11-26',
      householdSchedule: cal({ from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' }),
    });
    expect(section(agenda, 'scripture').next.unitId).toBe('holiday-thanksgiving');
    expect(section(agenda, 'scripture').obligation.state).toBe('obligated');
    expect(section(agenda, 'arts').obligation).toEqual({ state: 'excused', reason: 'day_off' });
    expect(section(agenda, 'english').obligation).toEqual({ state: 'excused', reason: 'day_off' });
  });

  it('a placeholder is offered by name but its section is excused', () => {
    const agenda = build({ entries: [...all, hol({ placeholder: true })], householdSchedule: enrichment });
    expect(section(agenda, 'civilization').next.unitId).toBe('hol');
    expect(section(agenda, 'civilization').obligation).toEqual({ state: 'excused', reason: 'placeholder' });
  });

  it('a kept program whose own schedule excludes the day is still not owed', () => {
    const agenda = build({
      entries: all, day: '2026-12-26',
      householdSchedule: cal({ from: '2026-12-21', to: '2026-12-31', label: 'Christmas break', tier: 'stay-home' }),
    });
    expect(section(agenda, 'arts').obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
    expect(section(agenda, 'scripture').obligation.state).toBe('obligated');
  });

  it('a normal-tier break is an ordinary school day that still carries its name', () => {
    const plain = build({ entries: all, householdSchedule: null });
    const normal = build({ entries: all, householdSchedule: cal({ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'normal' }) });
    expect(normal.sections).toEqual(plain.sections);
    expect(normal.dayOff).toEqual({ tier: 'normal', label: 'Veterans Day' });
    expect(plain.dayOff).toBeNull();
  });

  it('never un-serves work done on a dropped subject', () => {
    const pass = {
      sessionId: 's1', unitId: 'civ-1', state: 'closed', terminal: true, updatedAt: '2026-11-11T17:00:00.000Z',
      outcome: { result: 'passed', at: '2026-11-11T17:00:00.000Z' },
    };
    const agenda = build({
      entries: [scripture, { ...civ, status: 'completed' }], sessions: [pass],
      householdSchedule: cal({ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'stay-home' }),
    });
    expect(section(agenda, 'civilization').obligation.state).toBe('served');
  });

  it('a date-bound entry displaces its subject on an ordinary day too', () => {
    const agenda = build({ entries: [civ, hol()], householdSchedule: null });
    expect(section(agenda, 'civilization').next.unitId).toBe('hol');
  });
});
