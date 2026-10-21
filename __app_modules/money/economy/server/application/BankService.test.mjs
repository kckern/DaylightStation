import { describe, it, expect, vi } from 'vitest';
import { BankService, nextWeekClose } from './BankService.mjs';

const LA = 'America/Los_Angeles';

describe('nextWeekClose', () => {
  it('is this week\'s Sunday 23:30 local, from the cron', () => {
    // Tuesday 2026-10-20 08:00 PDT
    expect(nextWeekClose({ nowMs: Date.parse('2026-10-20T15:00:00Z'), studyDay: '2026-10-20', cron: '30 23 * * 0', timezone: LA }))
      .toBe('2026-10-26T06:30:00.000Z');
  });
  it('after Sunday\'s close, still Sunday\'s study day, it is next Sunday', () => {
    // Monday 00:30 PDT, before the 4 am boundary
    expect(nextWeekClose({ nowMs: Date.parse('2026-10-26T07:30:00Z'), studyDay: '2026-10-25', cron: '30 23 * * 0', timezone: LA }))
      .toBe('2026-11-02T07:30:00.000Z'); // PST by then
  });
  it('with no cron (or one it cannot read), the end of the week\'s Sunday: Monday 4 am', () => {
    for (const cron of [null, '*/5 * * * *']) {
      expect(nextWeekClose({ nowMs: Date.parse('2026-10-20T15:00:00Z'), studyDay: '2026-10-20', cron, timezone: LA }))
        .toBe('2026-10-26T11:00:00.000Z');
    }
  });
});

describe('BankService.bank', () => {
  const economy = {
    studyCalendar: { timezone: LA, boundaryHour: 4 },
    currentStudyDay: () => '2026-10-20',
    getBalance: async () => ({ balances: { silver: 4, gold: 2, gems: 0 } }),
    getHistory: async () => [
      { id: 'p', at: '2026-10-20T15:00:00.000Z', kind: 'earn', currency: 'silver', delta: 2, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:1' },
      { id: 'q', at: '2026-10-19T15:00:00.000Z', kind: 'earn', currency: 'silver', delta: 1, action: 'payout:green-day', ruleId: 'green-day', evidenceRef: 'line:old' },
      ...Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, at: '2026-10-01T15:00:00.000Z', kind: 'deposit', currency: 'silver', delta: 1, action: 'parent-deposit' })),
    ],
    passesToday: async () => [],
  };
  const config = { catalog: () => ({ week_close: { cron: '30 23 * * 0' },
    passes: { 'early-pass': { privileges: ['piano.games'], price: { silver: 3, gold: 0 } } } }) };
  const rules = { get: async () => ({ rules: [{ id: 'green-day', label: 'Green day' }] }) };
  const clock = () => new Date('2026-10-20T15:00:00Z');

  it('balances, the last 50 sentences, today\'s pass, offers per privilege and weekEndsAt', async () => {
    const bank = new BankService({ economy, config, rules, clock, evidenceLabels: async () => new Map([['line:1', 'Isaiah 50–51 passed']]) });
    const res = await bank.bank('kid');
    expect(res.balances).toEqual({ silver: 4, gold: 2, gems: 0 });
    expect(res.history).toHaveLength(50);
    expect(res.history.slice(0, 2).map((l) => l.text)).toEqual(['+2 silver · Isaiah 50–51 passed', '+1 silver · Green day']);
    expect(res.pass).toEqual({ state: 'none', studyDay: '2026-10-20' });
    expect(res.offers).toEqual({ 'piano.games': [{ coin: 'silver', price: 3, affordable: true }] });
    expect(res.weekEndsAt).toBe('2026-10-26T06:30:00.000Z');
  });
  it('a failing label source falls back to the rule labels, then a generic phrase', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const bank = new BankService({ economy, config, rules: { get: async () => { throw new Error('no rules'); } }, clock, logger,
      evidenceLabels: async () => { throw new Error('preview down'); } });
    const res = await bank.bank('kid');
    expect(res.history.slice(0, 2).map((l) => l.text)).toEqual(['+2 silver · schoolwork', '+1 silver · schoolwork']);
    expect(logger.warn).toHaveBeenCalledWith('economy.bank.labels-unavailable', expect.objectContaining({ source: 'evidence' }));
  });
  it('shows the latest of today\'s passes', async () => {
    const bank = new BankService({ economy: { ...economy, passesToday: async () => [{ passId: 'a', state: 'refunded' }, { passId: 'b', state: 'active' }] }, config, rules, clock });
    expect((await bank.bank('kid')).pass).toEqual({ passId: 'b', state: 'active' });
  });
});
