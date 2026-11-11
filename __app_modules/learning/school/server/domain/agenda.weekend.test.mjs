import { describe, expect, it } from 'vitest';
import { planDailyAgenda } from "./agenda.mjs";

const OPENS = { w1: '2026-11-02', w2: '2026-11-09', w3: '2026-11-16' };
const lesson = (module, day, status, over = {}) => ({
  unitId: `${module}-d${day}`, title: `${module} day ${day}`, subject: 'scripture', courseId: 'cfm',
  module, sequence: Number(module.slice(1)) * 10 + day, program: null, elective: false, status,
  timing: { mode: module === 'w1' ? 'catch_up' : 'dated' },
  timingState: module === 'w1' ? 'catch_up' : 'available',
  timingPriority: 2, timingRank: module === 'w1' ? 1 : 0,
  schedule: { daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
  weekendPolicy: 'backlog-then-review', moduleOpensOn: OPENS[module],
  ...over,
});
const week = (module, statuses) => statuses.map((status, index) => lesson(module, index + 1, status));
const pass = (unitId, at) => ({
  sessionId: `s-${unitId}-${at}`, unitId, state: 'closed', terminal: true, updatedAt: at,
  outcome: { result: 'passed', at },
});
const run = (entries, day, sessions = []) => planDailyAgenda({
  plan: { entries }, sessions, now: `${day}T18:00:00.000Z`,
}).sections.find((s) => s.subject === 'scripture');

const SATURDAY = '2026-11-14';
const SUNDAY = '2026-11-15';

describe('weekend scripture: backlog, then review, never advance', () => {
  it('offers the oldest undone lesson first on a Saturday', () => {
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
      ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
    ];
    const section = run(entries, SATURDAY);
    expect(section.next.unitId).toBe('w1-d4');
    expect(section.obligation.state).toBe('obligated');
  });

  it('with no backlog, re-sits the week\'s least recently passed lesson as a review', () => {
    const entries = [...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed'))];
    const sessions = [
      pass('w2-d1', '2026-11-09T18:00:00.000Z'), pass('w2-d2', '2026-11-12T18:00:00.000Z'),
      pass('w2-d3', '2026-11-11T18:00:00.000Z'), pass('w2-d4', '2026-11-10T17:00:00.000Z'),
      pass('w2-d5', '2026-11-13T18:00:00.000Z'), pass('w1-d1', '2026-11-02T18:00:00.000Z'),
      // An older re-pass of d4 does not make it older than its newest pass.
      pass('w2-d1', '2026-11-12T19:00:00.000Z'),
    ];
    const section = run(entries, SATURDAY, sessions);
    expect(section.next).toMatchObject({ unitId: 'w2-d4', review: true });
    expect(section.obligation.state).toBe('obligated');
  });

  it('a passed review re-sit serves Sunday', () => {
    const entries = [...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed'))];
    const sessions = [pass('w2-d3', '2026-11-11T18:00:00.000Z'), pass('w2-d3', `${SUNDAY}T17:00:00.000Z`)];
    const section = run(entries, SUNDAY, sessions);
    expect(section.obligation.state).toBe('served');
    expect(section.next).toBeNull();
  });

  it('never offers a lesson from a module that has not opened', () => {
    const entries = [
      ...week('w1', Array(5).fill('completed')), ...week('w2', Array(5).fill('completed')),
      lesson('w3', 1, 'available', { timingState: 'available' }),
    ];
    const section = run(entries, SATURDAY, [pass('w2-d1', '2026-11-09T18:00:00.000Z')]);
    expect(section.next.unitId).not.toBe('w3-d1');
    expect(section.next.review).toBe(true);
  });

  it('a weekday picks exactly what it picks without the policy', () => {
    const TUESDAY = '2026-11-10';
    const entries = [
      ...week('w1', ['completed', 'completed', 'completed', 'available', 'locked']),
      ...week('w2', ['completed', 'available', 'locked', 'locked', 'locked']),
    ];
    const without = entries.map(({ weekendPolicy: _p, moduleOpensOn: _o, ...rest }) => rest);
    const withPolicy = run(entries, TUESDAY);
    const plain = run(without, TUESDAY);
    expect(withPolicy.next.unitId).toBe(plain.next.unitId);
    expect(withPolicy.obligation).toEqual(plain.obligation);
  });

  it('a weekend without the policy behaves as before', () => {
    const entries = week('w2', ['completed', 'available', 'locked', 'locked', 'locked'])
      .map(({ weekendPolicy: _p, ...rest }) => ({ ...rest, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } }));
    expect(run(entries, SATURDAY).obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });
});
