// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EconomyService } from "./EconomyService.mjs";
import { PayoutService, payoutMeta, ringSteps } from "./PayoutService.mjs";
import { EarningsPreviewService } from "./EarningsPreviewService.mjs";
import { validateRuleset } from "../domain/earnings/index.mjs";

const LEARNERS = ['learner-a', 'learner-b'];
const ref = (learnerId, ruleId) => `earn:${learnerId}:${ruleId}:2026-09-21:on-time`;
const line = (learnerId, ruleId, kind, status, amount = { silver: 0, gems: 0 }) => ({ ruleId, kind, status, amount, ref: ref(learnerId, ruleId), timeliness: 'on-time' });

function weekFor(learnerId, over = {}) {
  return {
    learnerId,
    windows: { school: { from: '2026-09-21', to: '2026-09-27' } },
    lines: [
      line(learnerId, 'korean', 'section-day', 'earned', { silver: 4, gems: 0 }),
      line(learnerId, 'green-week', 'week-met', 'earned', { silver: 5, gems: 1 }),
      line(learnerId, 'contest', 'ring-contest', 'earned', { silver: 5, gems: 1 }),
      line(learnerId, 'green-day', 'day-met', 'indeterminate'),
      line(learnerId, 'math-week', 'section-week', 'pending'),
      line(learnerId, 'piano', 'unit', 'none'),
      line(learnerId, 'reading', 'unit', 'disabled'),
      ...(over.extra ?? []),
    ],
  };
}

function recorder() {
  const entries = [];
  const log = (level) => (event, data) => entries.push({ level, event, data });
  return { entries, logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }, of: (event) => entries.filter((e) => e.event === event) };
}

let root;
let configService;
const setup = ({ mode = 'live', weeks = null, rosterError = null } = {}) => {
  const state = { mode, weeks: weeks ?? Object.fromEntries(LEARNERS.map((id) => [id, weekFor(id)])), previews: [] };
  const log = recorder();
  const datastore = new YamlEconomyDatastore({ configService });
  const economy = new EconomyService({
    datastore,
    configProjection: new EconomyConfigProjection({ configService, logger: log.logger }),
    clock: () => new Date('2026-09-26T20:00:00.000Z'),
    logger: log.logger,
  });
  const preview = {
    async preview({ learnerId, week }) {
      state.previews.push({ learnerId, week });
      if (!state.weeks[learnerId]) throw new Error(`no learner ${learnerId}`);
      return state.weeks[learnerId];
    },
    currentStudyDay: () => '2026-09-24',
    async roster({ week }) {
      state.previews.push({ roster: true, week });
      if (rosterError) throw rosterError;
      return { learners: Object.values(state.weeks) };
    },
  };
  const payout = new PayoutService({ preview, economy, config: { catalog: () => ({ mode: state.mode }) }, logger: log.logger });
  return { state, log, payout, economy, ledger: (id) => datastore.readAllTransactions(id) };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-payout-'));
  configService = {
    getUserProfile: (id) => (LEARNERS.includes(id) ? { id } : null),
    getUserDir: (id) => path.join(root, id),
    getHouseholdAppConfig: () => ({}),
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('PayoutService.settle', () => {
  it('live: mints each earned line once; a second settle mints nothing', async () => {
    const { payout, ledger } = setup();
    const first = await payout.settle({ learnerId: 'learner-a', week: '2026-09-24' });
    expect(first.mode).toBe('live');
    expect(first.minted.map((m) => [m.ref, m.currency, m.amount])).toEqual([
      [ref('learner-a', 'korean'), 'silver', 4],
      [ref('learner-a', 'green-week'), 'silver', 5],
      [`${ref('learner-a', 'green-week')}:gems`, 'gems', 1],
      [ref('learner-a', 'contest'), 'silver', 5],
      [`${ref('learner-a', 'contest')}:gems`, 'gems', 1],
    ]);
    expect(first.skipped).toBe(0);
    expect(ledger('learner-a')).toHaveLength(5);

    const second = await payout.settle({ learnerId: 'learner-a', week: '2026-09-24' });
    expect(second).toMatchObject({ minted: [], skipped: 5, mode: 'live' });
    expect(ledger('learner-a')).toHaveLength(5);
  });

  it('asks the preview for the week it was given (default: the preview\'s own current week)', async () => {
    const { payout, state } = setup();
    await payout.settle({ learnerId: 'learner-a', week: '2026-09-24' });
    await payout.settle({ learnerId: 'learner-a' });
    expect(state.previews).toEqual([{ learnerId: 'learner-a', week: '2026-09-24' }, { learnerId: 'learner-a', week: null }]);
  });

  it('gems and silver land in their own currencies, the contest as a prize', async () => {
    const { payout, economy, ledger } = setup();
    await payout.settle({ learnerId: 'learner-a' });
    expect((await economy.getBalance('learner-a')).balances).toEqual({ silver: 14, gold: 0, gems: 2 });
    const contest = ledger('learner-a').filter((t) => t.ruleId === 'contest');
    expect(contest.map((t) => [t.kind, t.currency, t.delta])).toEqual([['prize', 'silver', 5], ['prize', 'gems', 1]]);
    expect(contest.every((t) => t.evidenceRef === ref('learner-a', 'contest') && t.source === 'payout')).toBe(true);
    expect(ledger('learner-a').find((t) => t.ruleId === 'korean')).toMatchObject({ kind: 'earn', timeliness: 'on-time' });
  });

  it('holds indeterminate and pending lines: never minted, one held log each', async () => {
    const { payout, ledger, log } = setup();
    await payout.settle({ learnerId: 'learner-a' });
    expect(ledger('learner-a').some((t) => ['green-day', 'math-week'].includes(t.ruleId))).toBe(false);
    expect(log.of('economy.payout.held').map((e) => e.data)).toEqual([
      { learnerId: 'learner-a', ref: ref('learner-a', 'green-day'), status: 'indeterminate', ruleId: 'green-day' },
      { learnerId: 'learner-a', ref: ref('learner-a', 'math-week'), status: 'pending', ruleId: 'math-week' },
    ]);
  });

  it('a line that grew since the last settle pays only the difference', async () => {
    const { payout, state, ledger } = setup();
    await payout.settle({ learnerId: 'learner-a' });
    state.weeks['learner-a'].lines[0].amount = { silver: 6, gems: 0 };
    const out = await payout.settle({ learnerId: 'learner-a' });
    expect(out.minted).toEqual([expect.objectContaining({ ref: ref('learner-a', 'korean'), currency: 'silver', amount: 2 })]);
    expect(ledger('learner-a').filter((t) => t.ruleId === 'korean').map((t) => t.delta)).toEqual([4, 2]);
  });

  it('a second identical dry-run settle logs nothing per line at info', async () => {
    const { payout, log } = setup({ mode: 'dry-run' });
    await payout.settle({ learnerId: 'learner-a' });
    const before = log.entries.length;
    await payout.settle({ learnerId: 'learner-a' });
    const second = log.entries.slice(before);
    expect(second.filter((e) => e.level === 'info')).toEqual([]);
    expect(second).toEqual([expect.objectContaining({ level: 'debug', event: 'economy.payout.settled' })]);
  });

  it('a changed line logs again: a held line that turns earned, a would-mint that grows', async () => {
    const { payout, state, log } = setup({ mode: 'dry-run' });
    await payout.settle({ learnerId: 'learner-a' });
    const before = log.entries.length;
    state.weeks['learner-a'].lines[0].amount = { silver: 6, gems: 0 };
    state.weeks['learner-a'].lines[3] = { ...state.weeks['learner-a'].lines[3], status: 'earned', amount: { silver: 1, gems: 0 } };
    await payout.settle({ learnerId: 'learner-a' });
    const info = log.entries.slice(before).filter((e) => e.level === 'info');
    expect(info.map((e) => [e.event, e.data.ref, e.data.amount])).toEqual([
      ['economy.payout.would-mint', ref('learner-a', 'korean'), 6],
      ['economy.payout.would-mint', ref('learner-a', 'green-day'), 1],
      ['economy.payout.settled', undefined, undefined],
    ]);
  });

  it('a non-integer amount is not minted and is logged as bad-amount', async () => {
    const { payout, state, ledger, log } = setup();
    state.weeks['learner-a'].lines[0].amount = { silver: 2.5, gems: 0 };
    await payout.settle({ learnerId: 'learner-a' });
    expect(ledger('learner-a').some((t) => t.ruleId === 'korean')).toBe(false);
    expect(log.of('economy.payout.bad-amount')).toEqual([expect.objectContaining({ level: 'warn', data: expect.objectContaining({ ref: ref('learner-a', 'korean'), amount: 2.5 }) })]);
  });

  it('a learner with no household wallet is said once at info, then skipped quietly (settle and settleAll alike)', async () => {
    const weeks = { 'learner-x': weekFor('learner-x'), 'learner-a': weekFor('learner-a') };
    const { payout, state, log } = setup({ weeks });
    expect(await payout.settle({ learnerId: 'learner-x' })).toMatchObject({ minted: [], reason: 'not-a-user' });
    await payout.settle({ learnerId: 'learner-x' });
    const all = await payout.settleAll({});
    expect(all.learners.map((l) => [l.learnerId, l.reason ?? l.minted.length])).toEqual([['learner-x', 'not-a-user'], ['learner-a', 5]]);
    expect(log.of('economy.payout.not-a-user')).toEqual([{ level: 'info', event: 'economy.payout.not-a-user', data: { learnerId: 'learner-x' } }]);
    expect(log.of('economy.payout.failed')).toEqual([]);
    expect(state.previews.filter((p) => p.learnerId === 'learner-x')).toEqual([]);
  });

  it('dry-run writes nothing and logs what it would mint', async () => {
    const { payout, log } = setup({ mode: 'dry-run' });
    const out = await payout.settle({ learnerId: 'learner-a' });
    expect(out).toMatchObject({ minted: [], skipped: 0, mode: 'dry-run' });
    expect(out.wouldMint).toHaveLength(5);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(log.of('economy.payout.would-mint').map((e) => e.data)).toContainEqual(
      { learnerId: 'learner-a', ref: `${ref('learner-a', 'green-week')}:gems`, currency: 'gems', amount: 1, ruleId: 'green-week' },
    );
    expect(log.of('economy.payout.would-mint')).toHaveLength(5);
  });

  it('off: no preview, no ledger, no per-line logs', async () => {
    const { payout, state, log } = setup({ mode: 'off' });
    const out = await payout.settle({ learnerId: 'learner-a' });
    expect(out).toEqual({ minted: [], skipped: 0, held: 0, mode: 'off' });
    expect(state.previews).toEqual([]);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(log.entries.filter((e) => e.level !== 'debug')).toEqual([]);
  });

  it('reads the mode on every settle, so a reload from dry-run to live takes effect', async () => {
    const { payout, state, ledger } = setup({ mode: 'dry-run' });
    await payout.settle({ learnerId: 'learner-a' });
    expect(ledger('learner-a')).toEqual([]);
    state.mode = 'live';
    const out = await payout.settle({ learnerId: 'learner-a' });
    expect(out.minted).toHaveLength(5);
  });

  it('two concurrent live settles for one learner mint each line exactly once', async () => {
    const { payout, ledger, economy } = setup();
    // Hold the learner's lock so both settles read an empty ledger first and
    // then queue their mints behind it: the race the event and the reconcile run.
    let release;
    const gate = new Promise((r) => { release = r; });
    const held = new YamlEconomyDatastore({ configService }).withUserLock('learner-a', () => gate);
    const runs = [payout.settle({ learnerId: 'learner-a' }), payout.settle({ learnerId: 'learner-a' })];
    await new Promise((r) => setTimeout(r, 20));
    release();
    await held;
    const [a, b] = await Promise.all(runs);
    expect(a.minted.length + b.minted.length).toBe(5);
    expect(ledger('learner-a')).toHaveLength(5);
    expect((await economy.getBalance('learner-a')).balances).toEqual({ silver: 14, gold: 0, gems: 2 });
  });

  it('currentStudyDay is the preview\'s', () => {
    const { payout } = setup();
    expect(payout.currentStudyDay()).toBe('2026-09-24');
  });

  it('a failing preview throws to the caller (the wiring logs it)', async () => {
    const { payout } = setup({ weeks: { 'learner-a': weekFor('learner-a') } });
    await expect(payout.settle({ learnerId: 'learner-b' })).rejects.toThrow(/no learner/);
  });
});

describe('PayoutService.settleAll', () => {
  it('settles every learner on the roster from one roster read', async () => {
    const { payout, state, ledger } = setup();
    const out = await payout.settleAll({ week: null });
    expect(state.previews).toEqual([{ roster: true, week: null }]);
    expect(out.mode).toBe('live');
    expect(out.learners.map((l) => [l.learnerId, l.minted.length])).toEqual([['learner-a', 5], ['learner-b', 5]]);
    expect(ledger('learner-b')).toHaveLength(5);
  });

  it('one learner failing does not stop the others; a corrupt ledger fails closed at error level', async () => {
    const { payout, ledger, log } = setup();
    const dir = path.join(root, 'learner-a', 'apps', 'economy', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-01-05.yml'), '- id: txn_old\n  delta: [unclosed\n');
    const out = await payout.settleAll({});
    expect(out.learners.map((l) => [l.learnerId, l.error ? 'failed' : l.minted.length])).toEqual([['learner-a', 'failed'], ['learner-b', 5]]);
    expect(fs.readdirSync(dir)).toEqual(['2026-01-05.yml']);
    expect(ledger('learner-b')).toHaveLength(5);
    expect(log.of('economy.payout.failed')).toEqual([
      expect.objectContaining({ level: 'error', data: expect.objectContaining({ learnerId: 'learner-a', code: 'CORRUPT_LEDGER' }) }),
    ]);
  });

  it('off: does not read the roster', async () => {
    const { payout, state } = setup({ mode: 'off' });
    expect(await payout.settleAll({})).toEqual({ learners: [], mode: 'off' });
    expect(state.previews).toEqual([]);
  });
});

// The real evaluator end to end: if the line shape the preview emits drifts
// (ref, amount, kind, timeliness), this pays the wrong thing and fails.
describe('PayoutService with the real EarningsPreviewService', () => {
  it('the ledger ends up holding exactly the preview\'s earned totals', async () => {
    const RULES = validateRuleset({
      revision: 3,
      rules: [
        { id: 'korean', kind: 'section-day', match: { subject: 'language' }, reward: 2 },
        { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
        { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
        { id: 'math-week', kind: 'section-week', match: { subject: 'math' }, reward: 3 },
      ],
      users: { 'learner-b': { rules: { contest: { disabled: true } } } },
    });
    const log = recorder();
    const preview = new EarningsPreviewService({
      rules: { get: async () => RULES },
      schoolEvidence: {
        async schoolWeek({ week }) {
          const day = (i) => new Date(Date.parse(`${week.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
          return {
            sectionDays: [
              { day: day(0), subject: 'language', state: 'served', reason: null },
              { day: day(1), subject: 'language', state: 'served', reason: null },
              { day: day(2), subject: 'math', state: 'faulted', reason: 'scan' },
            ],
            days: [0, 1, 2, 3, 4].map((i) => ({ day: day(i), state: 'met', reason: null })),
            week: { weekId: week.from, state: 'met', reason: null, open: false },
            units: [],
          };
        },
      },
      ringEvidence: { async standings() { return [{ learnerId: 'learner-a', rings: 12 }, { learnerId: 'learner-b', rings: 4 }]; } },
      learners: async () => LEARNERS.map((id) => ({ id })),
      clock: () => new Date('2026-09-27T17:00:00.000Z'), // Sunday: the week and the contest are closed
      timezone: 'America/Los_Angeles',
      logger: log.logger,
    });
    const economy = new EconomyService({
      datastore: new YamlEconomyDatastore({ configService }),
      configProjection: new EconomyConfigProjection({ configService, logger: log.logger }),
      logger: log.logger,
    });
    const payout = new PayoutService({ preview, economy, config: { catalog: () => ({ mode: 'live' }) }, logger: log.logger });

    const priced = await preview.roster({});
    await payout.settleAll({});
    await payout.settleAll({});
    for (const learner of priced.learners) {
      const { balances } = await economy.getBalance(learner.learnerId);
      expect({ silver: balances.silver, gems: balances.gems }).toEqual(learner.totals);
    }
    expect(priced.learners[0].totals).toEqual({ silver: 14, gems: 2 });
    expect(priced.learners[1].lines.find((l) => l.ruleId === 'contest').status).toBe('disabled');
    const ledgerA = new YamlEconomyDatastore({ configService }).readAllTransactions('learner-a');
    expect(ledgerA.find((t) => t.ruleId === 'contest' && t.currency === 'silver')).toMatchObject({ kind: 'prize', timeliness: 'on-time', ref: 'earn:learner-a:contest:2026-09-21:on-time' });
    expect(ledgerA.some((t) => t.ruleId === 'math-week')).toBe(false); // indeterminate: held
  });
});

describe('payoutMeta', () => {
  it('keeps the kind, the count and, for a per-day line, the days that pay', () => {
    expect(payoutMeta({ kind: 'section-day', count: 2, evidence: [
      { day: '2026-10-20', state: 'served' }, { day: '2026-10-19', state: 'served' }, { day: '2026-10-21', state: 'obligated' },
    ] })).toEqual({ kind: 'section-day', count: 2, days: ['2026-10-19', '2026-10-20'] });
    expect(payoutMeta({ kind: 'day-met', count: 1, evidence: [{ day: '2026-10-19', state: 'met' }, { day: '2026-10-20', state: 'not_met' }] }))
      .toEqual({ kind: 'day-met', count: 1, days: ['2026-10-19'] });
  });
  it('a ring line keeps its rings and no days', () => {
    expect(payoutMeta({ kind: 'ring-threshold', count: 540, evidence: [{ threshold: 250, reached: true }] })).toEqual({ kind: 'ring-threshold', count: 540 });
  });
});

describe('PayoutService: rings pay one entry per finished workout', () => {
  const priced = { revision: 0, multiplier: 1, rate: { rings: 100, silver: 1 }, thresholds: [{ at: 250, reward: { silver: 2, gems: 0 } }, { at: 500, reward: { silver: 3, gems: 0 } }] };
  const workout = (sessionId, rings, endMs, over = {}) => ({ sessionId, startMs: endMs - 3_600_000, endMs, rings, title: null, final: true, ...over });
  const ringLine = (sessions) => ({
    ...line('learner-a', 'rings', 'ring-threshold', 'earned', { silver: 99, gems: 0 }), priced, sessions,
  });
  const weekWith = (sessions) => ({ 'learner-a': { learnerId: 'learner-a', windows: { school: { from: '2026-09-21', to: '2026-09-27' } }, lines: [ringLine(sessions)] } });
  const ringsOf = (ledger) => ledger('learner-a').filter((t) => t.ruleId === 'rings');

  it('ringSteps prices each final workout at the running total, in end order, skipping running ones', () => {
    const steps = ringSteps(ringLine([workout('b', 300, 2000), workout('c', 50, 3000, { final: false }), workout('a', 120, 1000, { title: 'Ride' })]));
    expect(steps.map((s) => [s.meta.session.id, s.meta.count, s.amount.silver])).toEqual([['a', 120, 1], ['b', 420, 6]]);
    expect(steps[0].meta).toEqual({ kind: 'ring-threshold', count: 120, session: { id: 'a', title: 'Ride', startMs: 1000 - 3_600_000, rings: 120 } });
  });

  it('mints one entry per workout, each carrying its session; a resettle writes nothing', async () => {
    const { payout, ledger, state } = setup({ weeks: weekWith([workout('a', 120, 1000, { title: 'Ride' }), workout('b', 588, 2000)]) });
    await payout.settle({ learnerId: 'learner-a' });
    const rows = ringsOf(ledger);
    // 120 rings → 1; 708 rings → 7 + 2 + 3 = 12, so the second pays 11.
    expect(rows.map((t) => [t.delta, t.meta.session.id, t.meta.count])).toEqual([[1, 'a', 120], [11, 'b', 708]]);
    // The live line said 99: only finished workouts are paid.
    expect(rows.reduce((n, t) => n + t.delta, 0)).toBe(12);
    await payout.settle({ learnerId: 'learner-a' });
    expect(ringsOf(ledger)).toHaveLength(2);
    // The running workout finishes: it gets its own entry.
    state.weeks = weekWith([workout('a', 120, 1000), workout('b', 588, 2000), workout('c', 300, 3000)]);
    await payout.settle({ learnerId: 'learner-a' });
    expect(ringsOf(ledger).map((t) => [t.delta, t.meta.session.id])).toEqual([[1, 'a'], [11, 'b'], [3, 'c']]);
  });

  it('a workout that crosses no new silver step writes nothing; its rings roll into the next one\'s entry', async () => {
    const { payout, ledger } = setup({ weeks: weekWith([workout('a', 34, 1000), workout('b', 80, 2000)]) });
    await payout.settle({ learnerId: 'learner-a' });
    expect(ringsOf(ledger).map((t) => [t.delta, t.meta.session.id, t.meta.count])).toEqual([[1, 'b', 114]]);
  });

  it('a week already paid at live rates is never paid twice', async () => {
    const { payout, ledger, economy } = setup({ weeks: weekWith([workout('a', 600, 1000)]) });
    // Paid before per-workout pay: 10 silver under the week's ref.
    await economy.mint('learner-a', { currency: 'silver', amount: 10, ref: ref('learner-a', 'rings'), ruleId: 'rings', evidenceRef: ref('learner-a', 'rings') });
    await payout.settle({ learnerId: 'learner-a' });
    // 600 rings → 6 + 2 + 3 = 11: one more silver, not 11.
    expect(ringsOf(ledger).map((t) => t.delta)).toEqual([10, 1]);
  });
});
