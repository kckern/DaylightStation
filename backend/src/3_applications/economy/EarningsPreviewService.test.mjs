// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EarningsPreviewService } from './EarningsPreviewService.mjs';
import { validateRuleset } from '#domains/economy/earnings/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TZ = 'America/Los_Angeles';

const RULES = validateRuleset({
  revision: 2,
  rules: [
    { id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 },
    { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
    { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ],
});

function build({ now = '2026-09-26T17:00:00.000Z', school = null, rings = null, learners = null } = {}) {
  const calls = { school: [], rings: [] };
  const service = new EarningsPreviewService({
    rules: { get: async () => RULES },
    schoolEvidence: school ?? {
      async schoolWeek({ learnerId, week }) {
        calls.school.push({ learnerId, week });
        return {
          sectionDays: [{ day: '2026-09-21', subject: 'language', state: 'served', reason: null, timeliness: 'on-time' }],
          days: [0, 1, 2, 3, 4].map((i) => ({ day: new Date(Date.parse(`${week.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), state: 'met', reason: null, timeliness: 'on-time' })), week: { weekId: week.from, state: 'met', reason: null, open: false }, units: [],
        };
      },
    },
    ringEvidence: rings ?? {
      async standings(args) { calls.rings.push(args); return [{ learnerId: 'learner-a', rings: 12 }, { learnerId: 'learner-b', rings: 4 }]; },
    },
    learners: async () => learners ?? [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }],
    clock: () => new Date(now),
    timezone: TZ,
    logger: silent,
  });
  return { service, calls };
}

describe('EarningsPreviewService.preview', () => {
  it('prices one learner\'s week: Monday–Sunday school week, Monday 04:00 → Saturday 12:00 ring week', async () => {
    const { service, calls } = build();
    const out = await service.preview({ learnerId: 'learner-a', week: '2026-09-24' });
    expect(calls.school[0]).toEqual({ learnerId: 'learner-a', week: { from: '2026-09-21', to: '2026-09-27' } });
    // Monday 04:00 PDT = 11:00Z; Saturday 12:00 PDT = 19:00Z.
    expect(calls.rings[0]).toEqual({ learnerIds: ['learner-a', 'learner-b'], fromMs: Date.parse('2026-09-21T11:00:00.000Z'), toMs: Date.parse('2026-09-26T19:00:00.000Z') });
    expect(out.windows).toEqual({ school: { from: '2026-09-21', to: '2026-09-27' }, rings: { from: '2026-09-21T11:00:00.000Z', to: '2026-09-26T19:00:00.000Z' } });
    expect(out.totals).toEqual({ silver: 7, gems: 1 });
    expect(out.rulesRevision).toBe(2);
    expect(out.learnerName).toBe('Learner A');
    expect(out.evidence).toEqual({ school: 'ok', rings: 'ok' });
  });

  it('defaults to the current study day\'s week', async () => {
    const { service, calls } = build({ now: '2026-09-26T17:00:00.000Z' });
    await service.preview({ learnerId: 'learner-a' });
    expect(calls.school[0].week).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('the contest is pending before Saturday noon and settled after', async () => {
    const before = await build({ now: '2026-09-26T18:59:00.000Z' }).service.preview({ learnerId: 'learner-a' });
    expect(before.lines.find((l) => l.ruleId === 'contest').status).toBe('pending');
    expect(before.contestClosed).toBe(false);
    const after = await build({ now: '2026-09-26T19:00:00.000Z' }).service.preview({ learnerId: 'learner-a' });
    expect(after.lines.find((l) => l.ruleId === 'contest').status).toBe('earned');
    expect(after.contestClosed).toBe(true);
  });

  it('a past week is closed: its contest is settled, its week verdict is whatever School says', async () => {
    const out = await build().service.preview({ learnerId: 'learner-a', week: '2026-09-15' });
    expect(out.windows.school).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(out.contestClosed).toBe(true);
  });

  it('a failing evidence source makes its lines indeterminate and says so — never a silent zero', async () => {
    const { service } = build({
      school: { async schoolWeek() { throw new Error('verdict cache unreadable'); } },
      rings: { async standings() { throw new Error('fitness down'); } },
    });
    const out = await service.preview({ learnerId: 'learner-a' });
    expect(out.evidence).toEqual({ school: 'unavailable', rings: 'unavailable' });
    expect(out.lines.map((l) => [l.ruleId, l.status])).toEqual([['korean', 'indeterminate'], ['green-week', 'indeterminate'], ['contest', 'indeterminate']]);
  });

  it('refuses an unknown learner and a malformed week', async () => {
    const { service } = build();
    await expect(service.preview({ learnerId: 'nobody' })).rejects.toThrow(/nobody/);
    await expect(service.preview({ learnerId: 'learner-a', week: '26/09' })).rejects.toThrow(/week/);
  });
});

describe('EarningsPreviewService.roster', () => {
  it('prices every learner for the week, reading the rings standings once', async () => {
    const { service, calls } = build();
    const out = await service.roster({ week: '2026-09-24' });
    expect(out.learners.map((l) => [l.learnerId, l.totals.silver])).toEqual([['learner-a', 7], ['learner-b', 7]]);
    expect(calls.rings).toHaveLength(1);
    expect(out.windows.school).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });
});
