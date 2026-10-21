// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlEconomyDatastore } from "../adapters/persistence/YamlEconomyDatastore.mjs";
import { EconomyConfigProjection } from '../adapters/config/EconomyConfigProjection.mjs';
import { EconomyService } from "./EconomyService.mjs";
import { WeekCloseService, closingWeekFor } from "./WeekCloseService.mjs";

const LEARNERS = ['learner-a', 'learner-b']; // the school roster
// Household users: the roster, a parent (deposits, arcade) and a kid who left the roster.
const USERS = [...LEARNERS, 'parent-a', 'leaver'];
const WEEK = '2026-09-21'; // Monday
const SUNDAY = '2026-09-27';
const SILVER_TO_GOLD = [{ from: 'silver', to: 'gold', rate: 1 }];

function recorder() {
  const entries = [];
  const log = (level) => (event, data) => entries.push({ level, event, data });
  return { entries, logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }, of: (event) => entries.filter((e) => e.event === event) };
}

let root;
let configService;

const setup = ({ mode = 'live', convert = SILVER_TO_GOLD, today = SUNDAY, roster = LEARNERS, settleAll = null, datastore: makeDatastore = null } = {}) => {
  const state = { mode, convert, today, settles: [] };
  const log = recorder();
  const datastore = makeDatastore ? makeDatastore() : new YamlEconomyDatastore({ configService });
  const economy = new EconomyService({
    datastore,
    configProjection: new EconomyConfigProjection({ configService, logger: log.logger }),
    clock: () => new Date('2026-09-28T05:30:00.000Z'),
    logger: log.logger,
  });
  const payout = {
    currentStudyDay: () => state.today,
    async settleAll({ week }) {
      state.settles.push(week);
      if (settleAll) return settleAll({ week });
      // As PayoutService reports it: a roster learner with no wallet is `not-a-user`.
      return { mode: state.mode, learners: roster.map((learnerId) => ({ learnerId, minted: [], skipped: 0, held: 0, mode: state.mode,
        ...(USERS.includes(learnerId) ? {} : { reason: 'not-a-user' }) })) };
    },
  };
  const config = { catalog: () => ({ mode: state.mode, week_close: { cron: '30 23 * * 0', convert: state.convert } }) };
  const service = new WeekCloseService({ payout, economy, config, listUsers: () => USERS, logger: log.logger });
  return { state, log, service, economy, ledger: (id) => new YamlEconomyDatastore({ configService }).readAllTransactions(id) };
};

const fund = (economy, learnerId, amount, ref = `earn:${learnerId}:seed`) => economy.mint(learnerId, { currency: 'silver', amount, ref, ruleId: 'seed' });
const converts = (ledger) => ledger.filter((t) => t.kind === 'convert');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-week-close-'));
  configService = {
    getUserProfile: (id) => (USERS.includes(id) ? { id } : null),
    getUserDir: (id) => path.join(root, id),
    getHouseholdAppConfig: () => ({}),
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('closingWeekFor', () => {
  it('Sunday closes its own week', () => {
    expect(closingWeekFor('2026-09-27')).toBe('2026-09-21');
  });
  it('any other day closes the week whose Sunday has passed', () => {
    expect(closingWeekFor('2026-09-28')).toBe('2026-09-21'); // Monday after
    expect(closingWeekFor('2026-10-03')).toBe('2026-09-21'); // Saturday after
    expect(closingWeekFor('2026-09-26')).toBe('2026-09-14'); // Saturday before its own Sunday
  });
});

describe('WeekCloseService.close', () => {
  it('live: converts the whole silver balance to gold as one pair', async () => {
    const { service, economy, ledger } = setup();
    await fund(economy, 'learner-a', 12);
    const res = await service.close({ weekId: WEEK });
    const pair = converts(ledger('learner-a'));
    expect(pair).toHaveLength(2);
    const [silver, gold] = pair;
    expect(silver).toMatchObject({ currency: 'silver', delta: -12, ref: `close:learner-a:${WEEK}`, action: 'week-close', evidenceRef: `close:learner-a:${WEEK}` });
    expect(gold).toMatchObject({ currency: 'gold', delta: 12, ref: `close:learner-a:${WEEK}:gold`, action: 'week-close', evidenceRef: `close:learner-a:${WEEK}` });
    expect(silver.meta).toMatchObject({ weekId: WEEK, rate: 1 });
    expect(gold.meta).toMatchObject({ weekId: WEEK, rate: 1 });
    expect(silver.at).toBe(gold.at);
    expect((await economy.getBalance('learner-a')).balances).toEqual({ silver: 0, gold: 12, gems: 0 });
    expect(res.learners.find((l) => l.learnerId === 'learner-a').results[0]).toMatchObject({ status: 'converted', spent: 12, got: 12 });
  });

  it('settles the closing week before converting, so last-minute lines convert too', async () => {
    const { service, state, economy, ledger } = setup({
      settleAll: async ({ week }) => {
        await fund(economy, 'learner-a', 5, 'earn:learner-a:contest');
        return { mode: 'live', learners: [{ learnerId: 'learner-a' }] };
      },
    });
    await fund(economy, 'learner-a', 7);
    await service.close({ weekId: WEEK });
    expect(state.settles).toEqual([WEEK]);
    expect(converts(ledger('learner-a')).map((t) => t.delta)).toEqual([-12, 12]);
  });

  it('running twice is a no-op', async () => {
    const { service, economy, ledger } = setup();
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    await fund(economy, 'learner-a', 3, 'earn:learner-a:late'); // late silver waits for next close
    const again = await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a'))).toHaveLength(2);
    expect((await economy.getBalance('learner-a')).balances).toEqual({ silver: 3, gold: 12, gems: 0 });
    expect(again.learners.find((l) => l.learnerId === 'learner-a').results[0].status).toBe('already-converted');
  });

  it('late silver converts at the next week\'s close', async () => {
    const { service, state, economy, ledger } = setup();
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    await fund(economy, 'learner-a', 3, 'earn:learner-a:late');
    state.today = '2026-10-04';
    await service.close({ weekId: '2026-09-28' });
    expect(converts(ledger('learner-a')).map((t) => [t.ref, t.delta])).toEqual([
      [`close:learner-a:${WEEK}`, -12], [`close:learner-a:${WEEK}:gold`, 12],
      ['close:learner-a:2026-09-28', -3], ['close:learner-a:2026-09-28:gold', 3],
    ]);
  });

  it('zero silver writes nothing', async () => {
    const { service, ledger } = setup();
    const res = await service.close({ weekId: WEEK });
    expect(ledger('learner-a')).toEqual([]);
    expect(ledger('learner-b')).toEqual([]);
    expect(res.learners[0].results[0].status).toBe('nothing');
  });

  it('dry-run logs would-convert and writes nothing', async () => {
    const { service, economy, ledger, log } = setup({ mode: 'dry-run' });
    await fund(economy, 'learner-a', 12);
    const before = ledger('learner-a');
    await service.close({ weekId: WEEK });
    expect(ledger('learner-a')).toEqual(before);
    expect(log.of('economy.week-close.would-convert')).toEqual([
      { level: 'info', event: 'economy.week-close.would-convert', data: expect.objectContaining({ learnerId: 'learner-a', weekId: WEEK, silver: 12, gold: 12, rate: 1 }) },
    ]);
  });

  it('off: no settle, no read, no write', async () => {
    const { service, state, economy, ledger } = setup({ mode: 'off' });
    await fund(economy, 'learner-a', 12);
    const res = await service.close({ weekId: WEEK });
    expect(state.settles).toEqual([]);
    expect(converts(ledger('learner-a'))).toEqual([]);
    expect(res.learners).toEqual([]);
  });

  it('crash between halves: the next close writes the missing gold half', async () => {
    let failGold = true;
    const { service, economy, ledger, log } = setup({
      datastore: () => {
        const ds = new YamlEconomyDatastore({ configService });
        const append = ds.appendTransaction.bind(ds);
        ds.appendTransaction = async (userId, txn) => {
          if (failGold && txn.kind === 'convert' && txn.currency === 'gold') throw new Error('disk full');
          return append(userId, txn);
        };
        return ds;
      },
    });
    await fund(economy, 'learner-a', 12);
    const first = await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => t.currency)).toEqual(['silver']);
    expect(first.learners.find((l) => l.learnerId === 'learner-a').results[0].error).toBe('disk full');
    expect(log.of('economy.week-close.failed')).toHaveLength(1);
    // The out half landed, so the wallet cache says so too.
    expect(new YamlEconomyDatastore({ configService }).readWallet('learner-a').balances).toEqual({ silver: 0, gold: 0, gems: 0 });

    failGold = false;
    await fund(economy, 'learner-a', 4, 'earn:learner-a:late'); // must not change the repaired amount
    const second = await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => [t.currency, t.delta])).toEqual([['silver', -12], ['gold', 12]]);
    expect((await economy.getBalance('learner-a')).balances).toEqual({ silver: 4, gold: 12, gems: 0 });
    expect(second.learners.find((l) => l.learnerId === 'learner-a').results[0].status).toBe('repaired');
    expect(log.of('economy.week-close.repaired')).toHaveLength(1);
  });

  it('a racing payout cannot slip silver between the balance read and the pair', async () => {
    const { service, economy, ledger } = setup();
    await fund(economy, 'learner-a', 12);
    await Promise.all([service.close({ weekId: WEEK }), fund(economy, 'learner-a', 5, 'earn:learner-a:race')]);
    const pair = converts(ledger('learner-a'));
    const balances = (await economy.getBalance('learner-a')).balances;
    // Either the mint landed first (17 converts) or after (5 waits), never torn.
    expect(-pair[0].delta).toBe(pair[1].delta);
    expect(balances.silver + balances.gold).toBe(17);
  });

  it('a corrupt shard refuses the close at error level and writes nothing', async () => {
    const { service, economy, ledger, log } = setup();
    await fund(economy, 'learner-a', 12);
    fs.writeFileSync(path.join(root, 'learner-a', 'apps', 'economy', 'ledger', '2026-09-01.yml'), 'a: [unclosed');
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a'))).toEqual([]);
    expect(log.of('economy.week-close.failed')).toEqual([
      expect.objectContaining({ level: 'error', data: expect.objectContaining({ learnerId: 'learner-a', code: 'CORRUPT_LEDGER' }) }),
    ]);
  });

  it('a fractional rate floors the gold; a balance too small for one gold converts nothing', async () => {
    const { service, economy, ledger, log } = setup({ convert: [{ from: 'silver', to: 'gold', rate: 0.1 }] });
    await fund(economy, 'learner-a', 25);
    await fund(economy, 'learner-b', 7);
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => t.delta)).toEqual([-25, 2]);
    expect(converts(ledger('learner-b'))).toEqual([]);
    expect((await economy.getBalance('learner-b')).balances.silver).toBe(7);
    expect(log.of('economy.week-close.below-rate')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ learnerId: 'learner-b', silver: 7, rate: 0.1 }) }),
    ]);
  });

  it.each([
    ['an unknown currency', { from: 'silver', to: 'platinum', rate: 1 }],
    ['the same currency', { from: 'silver', to: 'silver', rate: 1 }],
    ['a zero rate', { from: 'silver', to: 'gold', rate: 0 }],
    ['a negative rate', { from: 'silver', to: 'gold', rate: -1 }],
    ['a string rate', { from: 'silver', to: 'gold', rate: '1' }],
    ['an infinite rate', { from: 'silver', to: 'gold', rate: Infinity }],
    ['not a map', 'silver->gold'],
  ])('a rule with %s logs bad-rule and is skipped', async (_label, rule) => {
    const { service, economy, ledger, log } = setup({ convert: [rule] });
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a'))).toEqual([]);
    expect(log.of('economy.week-close.bad-rule')).toHaveLength(1);
  });

  it('a second rule reusing a currency is a bad rule; the first still converts', async () => {
    const { service, economy, ledger, log } = setup({ convert: [...SILVER_TO_GOLD, { from: 'silver', to: 'gems', rate: 1 }] });
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => t.currency)).toEqual(['silver', 'gold']);
    expect(log.of('economy.week-close.bad-rule')).toEqual([expect.objectContaining({ data: expect.objectContaining({ reason: 'overlaps' }) })]);
  });

  it('no weekId: closes the week whose Sunday is today or has passed', async () => {
    const { service, state, economy, ledger } = setup({ today: '2026-09-29' }); // Tuesday after
    await fund(economy, 'learner-a', 12);
    const res = await service.close();
    expect(res.weekId).toBe(WEEK);
    expect(state.settles).toEqual([WEEK]);
    expect(converts(ledger('learner-a'))[0].ref).toBe(`close:learner-a:${WEEK}`);
  });

  it('a weekId that is not a Monday reads as its week', async () => {
    const { service } = setup();
    expect((await service.close({ weekId: '2026-09-24' })).weekId).toBe(WEEK);
  });

  it('a roster learner without a wallet (PayoutService said so) is skipped without a failure', async () => {
    const { service, log } = setup({ roster: ['learner-a', 'stranger'] });
    const res = await service.close({ weekId: WEEK });
    expect(res.learners.map((l) => l.learnerId)).not.toContain('stranger');
    expect(log.of('economy.week-close.failed')).toEqual([]);
  });

  it('a settle failure for one learner does not block that learner\'s close', async () => {
    const { service, economy, ledger } = setup({
      settleAll: async () => ({ mode: 'live', learners: [{ learnerId: 'learner-a', error: 'preview down' }, { learnerId: 'learner-b' }] }),
    });
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => t.delta)).toEqual([-12, 12]);
  });

  it('a week-wide settle failure logs settle-failed and still converts the payout earners', async () => {
    const { service, economy, ledger, log } = setup({ settleAll: async () => { throw new Error('roster down'); } });
    await fund(economy, 'learner-a', 12);
    await economy.deposit('learner-b', { amount: 9 }); // a roster kid with no payout: unreachable without the roster
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-a')).map((t) => t.delta)).toEqual([-12, 12]);
    expect(converts(ledger('learner-b'))).toEqual([]);
    expect(log.of('economy.week-close.settle-failed')).toEqual([
      expect.objectContaining({ level: 'warn', data: expect.objectContaining({ weekId: WEEK, error: 'roster down' }) }),
    ]);
  });

  it('a corrupt ledger in the week-wide settle logs settle-failed at error', async () => {
    const corrupt = Object.assign(new Error('shard is not a list'), { code: 'CORRUPT_LEDGER' });
    const { service, log } = setup({ settleAll: async () => { throw corrupt; } });
    await service.close({ weekId: WEEK });
    expect(log.of('economy.week-close.settle-failed')).toEqual([expect.objectContaining({ level: 'error' })]);
  });

  it('an off-roster user with a payout entry converts', async () => {
    const { service, economy, ledger } = setup();
    await fund(economy, 'leaver', 8);
    await economy.deposit('leaver', { amount: 2 });
    const res = await service.close({ weekId: WEEK });
    expect(converts(ledger('leaver')).map((t) => t.delta)).toEqual([-10, 10]);
    expect(res.learners.map((l) => l.learnerId)).toEqual(['learner-a', 'learner-b', 'parent-a', 'leaver']);
  });

  it('a household user with only deposit silver never converts', async () => {
    const { service, economy, ledger } = setup();
    await economy.deposit('parent-a', { amount: 40 });
    const res = await service.close({ weekId: WEEK });
    expect(converts(ledger('parent-a'))).toEqual([]);
    expect((await economy.getBalance('parent-a')).balances.silver).toBe(40);
    expect(res.learners.find((l) => l.learnerId === 'parent-a').results[0].status).toBe('not-an-earner');
  });

  it('a roster learner is closed even without a payout entry', async () => {
    const { service, economy, ledger } = setup();
    await economy.deposit('learner-b', { amount: 4 });
    await service.close({ weekId: WEEK });
    expect(converts(ledger('learner-b')).map((t) => t.delta)).toEqual([-4, 4]);
  });

  it('refuses a week that has not ended, before any settle', async () => {
    const { service, state, economy, ledger, log } = setup({ today: '2026-09-26' }); // Saturday
    await fund(economy, 'learner-a', 12);
    await expect(service.close({ weekId: WEEK })).rejects.toMatchObject({ name: 'ValidationError', code: 'WEEK_NOT_ENDED' });
    expect(state.settles).toEqual([]);
    expect(converts(ledger('learner-a'))).toEqual([]);
    expect(log.of('economy.week-close.refused')).toEqual([
      expect.objectContaining({ level: 'warn', data: { weekId: WEEK, today: '2026-09-26', reason: 'week-not-ended' } }),
    ]);
  });

  it('a skipped learner logs one skipped event at debug', async () => {
    const { service, log } = setup();
    await service.close({ weekId: WEEK });
    expect(log.of('economy.week-close.skipped').map((e) => [e.level, e.data.status])).toContainEqual(['debug', 'nothing']);
    expect(log.entries.filter((e) => e.event === 'economy.week-close.nothing')).toEqual([]);
  });

  it('live logs every conversion at info and a summary', async () => {
    const { service, economy, log } = setup();
    await fund(economy, 'learner-a', 12);
    await service.close({ weekId: WEEK });
    expect(log.of('economy.week-close.converted')).toEqual([
      { level: 'info', event: 'economy.week-close.converted', data: expect.objectContaining({ learnerId: 'learner-a', weekId: WEEK, silver: 12, gold: 12, rate: 1 }) },
    ]);
    expect(log.of('economy.week-close.closed')).toEqual([
      expect.objectContaining({ level: 'info', data: expect.objectContaining({ weekId: WEEK, mode: 'live', converted: 1 }) }),
    ]);
  });
});
