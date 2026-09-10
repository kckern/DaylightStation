// @vitest-environment node
/**
 * `cadence: 'weekly'` — owed once per Monday→Sunday week, offered every day
 * until done, the day it was done reads served, the rest of the week reads
 * excused: weekly_satisfied. And the term grid's 8th row (`section.weekly`).
 */
import { describe, it, expect } from 'vitest';
import { planDailyAgenda } from './agenda.mjs';

const NOW = '2026-09-09T18:00:00.000Z'; // Wednesday
const entry = (over = {}) => ({
  unitId: 'pe:weekly', title: 'PE', subject: 'skills', program: 'garage-fitness', programInstance: null,
  cadence: 'weekly', status: 'available', elective: false, timingState: 'available', timing: null, ...over,
});
const status = (doneToday, weekly) => ({ 'garage-fitness': { doneToday, progressLabel: null, score: null, weekly } });

describe('planDailyAgenda — weekly cadence', () => {
  it('open all week: offered, obligated, weekly row open', () => {
    const { sections } = planDailyAgenda({ plan: { entries: [entry()] }, now: NOW, programStatuses: status(false, { weekFrom: '2026-09-07', servedOn: null, satisfiedBefore: false }) });
    expect(sections[0]).toMatchObject({ subject: 'skills', obligation: { state: 'obligated' } });
    expect(sections[0].next?.unitId).toBe('pe:weekly');
    expect(sections[0].weekly).toEqual([{ unitId: 'pe:weekly', subject: 'skills', state: 'open', servedOn: null }]);
  });

  it('the day it is done reads served', () => {
    const { sections } = planDailyAgenda({ plan: { entries: [entry()] }, now: NOW, programStatuses: status(true, { weekFrom: '2026-09-07', servedOn: '2026-09-09', satisfiedBefore: false }) });
    expect(sections[0].obligation).toEqual({ state: 'served', reason: null });
    expect(sections[0].weekly[0]).toMatchObject({ state: 'served', servedOn: '2026-09-09' });
  });

  it('later in the same week: not offered, excused weekly_satisfied, weekly row satisfied', () => {
    const { sections } = planDailyAgenda({ plan: { entries: [entry()] }, now: NOW, programStatuses: status(false, { weekFrom: '2026-09-07', servedOn: '2026-09-07', satisfiedBefore: true }) });
    expect(sections[0].next).toBeNull();
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'weekly_satisfied' });
    expect(sections[0].weekly[0]).toMatchObject({ state: 'satisfied', servedOn: '2026-09-07' });
  });

  it('a satisfied weekly program does not hold a curriculum sibling back from served', () => {
    const math = { unitId: 'm1', subject: 'skills', status: 'available', elective: false, timingState: 'available' };
    const passed = [{ unitId: 'm1', outcome: { result: 'passed', at: NOW }, updatedAt: NOW, gradedPercent: 90 }];
    const { sections } = planDailyAgenda({ plan: { entries: [entry(), math] }, sessions: passed, now: NOW, programStatuses: status(false, { weekFrom: '2026-09-07', servedOn: '2026-09-07', satisfiedBefore: true }) });
    expect(sections[0].obligation.state).toBe('served');
  });

  it('a daily program carries no weekly row', () => {
    const { sections } = planDailyAgenda({ plan: { entries: [entry({ cadence: 'daily' })] }, now: NOW, programStatuses: status(false) });
    expect(sections[0].weekly).toEqual([]);
  });
});
