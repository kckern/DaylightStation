// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EconomyService } from "./EconomyService.mjs";
import { PayoutService } from "./PayoutService.mjs";

const LEARNERS = ['learner-a', 'learner-b'];
const ref = (learnerId, ruleId) => `earn:${learnerId}:${ruleId}:2026-09-21:on-time`;
const line = (learnerId, ruleId, kind, status, amount = { silver: 0, gems: 0 }) => ({ ruleId, kind, status, amount, ref: ref(learnerId, ruleId) });

function weekFor(learnerId, over = {}) {
  return {
    learnerId,
    lines: [
      line(learnerId, 'korean', 'section-day', 'earned', { silver: 4, gems: 0 }),
      line(learnerId, 'green-week', 'week-met', 'earned', { silver: 5, gems: 1 }),
      line(learnerId, 'contest', 'ring-contest', 'earned', { silver: 5, gems: 1 }),
      line(learnerId, 'green-day', 'day-met', 'indeterminate'),
      line(learnerId, 'math-week', 'section-week', 'pending'),
      line(learnerId, 'piano', 'unit', 'none'),
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

  it('a failing preview throws to the caller (the wiring logs it)', async () => {
    const { payout } = setup();
    await expect(payout.settle({ learnerId: 'learner-z' })).rejects.toThrow(/no learner/);
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

  it('one learner failing does not stop the others, and is logged', async () => {
    const weeks = { 'learner-x': weekFor('learner-x'), 'learner-a': weekFor('learner-a') };
    const { payout, ledger, log } = setup({ weeks });
    const out = await payout.settleAll({});
    expect(out.learners.map((l) => [l.learnerId, l.error ? 'failed' : l.minted.length])).toEqual([['learner-x', 'failed'], ['learner-a', 5]]);
    expect(ledger('learner-a')).toHaveLength(5);
    expect(log.of('economy.payout.failed')[0].data).toMatchObject({ learnerId: 'learner-x' });
  });

  it('off: does not read the roster', async () => {
    const { payout, state } = setup({ mode: 'off' });
    expect(await payout.settleAll({})).toEqual({ learners: [], mode: 'off' });
    expect(state.previews).toEqual([]);
  });
});
