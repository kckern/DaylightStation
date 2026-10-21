import { describe, it, expect, vi } from 'vitest';
import { BankService, nextWeekClose } from './BankService.mjs';

const LA = 'America/Los_Angeles';
const TUESDAY = Date.parse('2026-10-20T15:00:00Z'); // 08:00 PDT

describe('nextWeekClose', () => {
  it('is the cron\'s next instant in the household timezone', () => {
    expect(nextWeekClose({ nowMs: TUESDAY, studyDay: '2026-10-20', cron: '30 23 * * 0', timezone: LA })).toBe('2026-10-26T06:30:00.000Z');
  });
  it('reads any cron the scheduler reads: lists and day names', () => {
    expect(nextWeekClose({ nowMs: TUESDAY, studyDay: '2026-10-20', cron: '0,30 23 * * SUN', timezone: LA })).toBe('2026-10-26T06:00:00.000Z');
    // Sunday 23:15 PDT: the 23:30 slot of the same night.
    expect(nextWeekClose({ nowMs: Date.parse('2026-10-26T06:15:00Z'), studyDay: '2026-10-25', cron: '0,30 23 * * SUN', timezone: LA }))
      .toBe('2026-10-26T06:30:00.000Z');
  });
  it('after Sunday\'s close it is next Sunday, across the DST change', () => {
    expect(nextWeekClose({ nowMs: Date.parse('2026-10-26T07:30:00Z'), studyDay: '2026-10-25', cron: '30 23 * * 0', timezone: LA }))
      .toBe('2026-11-02T07:30:00.000Z');
  });
  it('with no cron, the end of the week\'s Sunday study day: Monday 4 am', () => {
    expect(nextWeekClose({ nowMs: TUESDAY, studyDay: '2026-10-20', cron: null, timezone: LA })).toBe('2026-10-26T11:00:00.000Z');
  });
  it('a cron that does not parse falls back too, and says so', () => {
    const onUnreadable = vi.fn();
    expect(nextWeekClose({ nowMs: TUESDAY, studyDay: '2026-10-20', cron: 'every sunday', timezone: LA, onUnreadable })).toBe('2026-10-26T11:00:00.000Z');
    expect(onUnreadable).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('BankService.bank', () => {
  const pianoPass = { passId: 'pass:kid:2026-10-20', state: 'active', pass: 'early-pass', privilege: 'piano.games' };
  const makeEconomy = (over = {}) => ({
    studyCalendar: { timezone: LA, boundaryHour: 4 },
    currentStudyDay: () => '2026-10-20',
    getHistory: async () => [
      { id: 'p', at: '2026-10-20T15:00:00.000Z', kind: 'earn', currency: 'silver', delta: 2, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:1' },
      { id: 'q', at: '2026-10-19T15:00:00.000Z', kind: 'earn', currency: 'silver', delta: 1, action: 'payout:green-day', ruleId: 'green-day', evidenceRef: 'line:old' },
      ...Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, at: '2026-10-01T15:00:00.000Z', kind: 'deposit', currency: 'silver', delta: 1, action: 'parent-deposit' })),
    ],
    passesToday: async () => [],
    ...over,
  });
  const config = { catalog: () => ({ week_close: { cron: '30 23 * * 0' },
    passes: {
      'early-pass': { privileges: ['piano.games'], price: { silver: 3, gold: 0 }, cap: { per: 'study-day', count: 1, across: 'all-passes' } },
      arcade: { privileges: ['arcade'], price: { silver: 70 }, cap: { per: 'study-day', count: 1, across: 'all-passes' } },
    } }) };
  const rules = { get: async () => ({ rules: [{ id: 'green-day', label: 'Green day' }] }) };
  const clock = () => new Date(TUESDAY);
  const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

  it('balances and offers come from the ledger fold the history read, not the wallet', async () => {
    const bank = new BankService({ economy: makeEconomy({ getBalance: async () => ({ balances: { silver: 999 } }) }), config, rules, clock,
      evidenceLabels: async () => new Map([['line:1', 'Isaiah 50–51 passed']]) });
    const res = await bank.bank('kid');
    expect(res.balances).toEqual({ silver: 63, gold: 0, gems: 0 });
    expect(res.offers).toEqual({ 'piano.games': [{ coin: 'silver', price: 3, affordable: true }], arcade: [{ coin: 'silver', price: 70, affordable: false }] });
    expect(res.history).toHaveLength(50);
    expect(res.history.slice(0, 2).map((l) => l.text)).toEqual(['+2 silver · Isaiah 50–51 passed', '+1 silver · Green day']);
    expect(res.weekEndsAt).toBe('2026-10-26T06:30:00.000Z');
  });
  it('pass is keyed by privilege, with one "none" shape and whether the cap is used', async () => {
    const bank = new BankService({ economy: makeEconomy({ passesToday: async () => [pianoPass] }), config, rules, clock });
    const { pass } = await bank.bank('kid');
    expect(pass['piano.games']).toMatchObject({ ...pianoPass, capUsed: true });
    // Across all passes: the piano pass uses up arcade's day too.
    expect(pass.arcade).toMatchObject({ passId: null, state: 'none', privilege: 'arcade', studyDay: '2026-10-20', capUsed: true });
    const fresh = await new BankService({ economy: makeEconomy(), config, rules, clock }).bank('kid');
    expect(fresh.pass['piano.games']).toMatchObject({ state: 'none', capUsed: false });
    expect(Object.keys(fresh.pass['piano.games']).sort()).toEqual(Object.keys(fresh.pass.arcade).sort());
  });
  it('reads today\'s passes strictly; a corrupt shard shows "unknown" and is logged', async () => {
    const logger = quiet();
    const passesToday = vi.fn(async () => { throw Object.assign(new Error('bad shard'), { code: 'CORRUPT_LEDGER' }); });
    const res = await new BankService({ economy: makeEconomy({ passesToday }), config, rules, clock, logger }).bank('kid');
    expect(passesToday).toHaveBeenCalledWith('kid', { strict: true });
    expect(res.pass['piano.games']).toMatchObject({ state: 'unknown', privilege: 'piano.games', capUsed: null });
    expect(logger.warn).toHaveBeenCalledWith('economy.bank.pass-unreadable', expect.objectContaining({ userId: 'kid' }));
  });
  it('any other pass read failure is not hidden', async () => {
    const passesToday = async () => { throw new Error('boom'); };
    await expect(new BankService({ economy: makeEconomy({ passesToday }), config, rules, clock }).bank('kid')).rejects.toThrow('boom');
  });
  it('a failing label source falls back to the rule labels, then a generic phrase', async () => {
    const logger = quiet();
    const bank = new BankService({ economy: makeEconomy(), config, rules: { get: async () => { throw new Error('no rules'); } }, clock, logger,
      evidenceLabels: async () => { throw new Error('preview down'); } });
    const res = await bank.bank('kid');
    expect(res.history.slice(0, 2).map((l) => l.text)).toEqual(['+2 silver · schoolwork', '+1 silver · schoolwork']);
    expect(logger.warn).toHaveBeenCalledWith('economy.bank.labels-unavailable', expect.objectContaining({ source: 'evidence' }));
  });
});
