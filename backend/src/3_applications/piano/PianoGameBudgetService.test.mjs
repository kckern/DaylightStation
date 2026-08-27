import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PianoGameBudgetService } from './PianoGameBudgetService.mjs';
import { emptyDay } from '#domains/piano/gameBudget.mjs';

function makeStore() {
  const days = new Map();
  return {
    loadDay: vi.fn((d) => structuredClone(days.get(d)) ?? emptyDay(d)),
    saveDay: vi.fn((day) => { days.set(day.studyDate, structuredClone(day)); }),
    _days: days,
  };
}

const CFG = { enabled: true, dailyMinutes: 45, deviceDailyMinutes: 120, warnAtMinutes: 5, idleAfterSeconds: 90, users: {} };
let store; let now; let svc;
beforeEach(() => {
  store = makeStore();
  now = new Date('2026-08-27T20:00:00.000Z');
  let n = 0;
  svc = new PianoGameBudgetService({
    store, config: () => CFG, timezone: 'America/Los_Angeles',
    clock: () => now, idFactory: () => `sess_${++n}`,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
});

describe('PianoGameBudgetService', () => {
  it('open persists the session and returns the seed cumulative + balance', async () => {
    const r = await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r).toMatchObject({
      enabled: true, sessionId: 'sess_1', cumulativeSeconds: 0,
      secondsLeft: 45 * 60, warnAtSeconds: 300, idleAfterSeconds: 90, settleIntervalSec: 60,
    });
    expect(store.saveDay).toHaveBeenCalled();
  });

  it('a reopen within the stale window adopts the session — the reload fix', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 120 });
    now = new Date('2026-08-27T20:02:00.000Z');
    const r = await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r.sessionId).toBe('sess_1');
    expect(r.cumulativeSeconds).toBe(120);     // client seeds here, not at zero
  });

  it('settle reports depletion against the LEARNER allowance and the DEVICE cap separately', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    const r = await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 45 * 60 });
    expect(r.depleted).toBe(true);
    expect(r.deviceDepleted).toBe(false);
    expect(r.secondsLeft).toBe(0);
  });

  it('disabled config opens nothing and writes nothing', async () => {
    const off = new PianoGameBudgetService({
      store, config: () => ({ enabled: false }), clock: () => now,
      idFactory: () => 'x', logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const r = await off.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r).toEqual({ enabled: false });
    expect(store.saveDay).not.toHaveBeenCalled();
  });

  it('a store write failure surfaces as budget.settle-failed and rethrows (D16)', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    store.saveDay.mockImplementationOnce(() => { throw new Error('disk says no'); });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, timezone: 'America/Los_Angeles', clock: () => now, idFactory: () => 'y', logger,
    });
    await expect(svc2.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 30 }))
      .rejects.toThrow('disk says no');
    expect(logger.error).toHaveBeenCalledWith('budget.settle-failed', expect.objectContaining({
      sessionId: 'sess_1', learnerId: 'kid_a',
    }));
  });

  it('the day rolls at the study boundary: a 3am settle still lands on yesterday (D6)', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    now = new Date('2026-08-28T09:30:00.000Z'); // 02:30 LA — same study day
    await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 60 });
    expect(store._days.get('2026-08-27').learners.kid_a.totalSeconds).toBe(60);
    expect(store._days.has('2026-08-28')).toBe(false);
  });

  it('a settle that CROSSES the boundary lands on the new day and says so', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, timezone: 'America/Los_Angeles',
      clock: () => now, idFactory: () => 'sess_x', logger,
    });
    await svc2.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    now = new Date('2026-08-28T12:30:00.000Z'); // 05:30 LA — the study day has rolled
    await svc2.settle({ sessionId: 'sess_x', learnerId: 'kid_a', cumulativeSeconds: 60 });
    // A session open across 4am does not carry yesterday's spend into today.
    expect(store._days.has('2026-08-28')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('budget.day-rollover', expect.objectContaining({
      learnerId: 'kid_a', from: '2026-08-27', to: '2026-08-28',
    }));
  });

  // --- Fail-open on the two config-shape throws Task 1 added -------------
  //
  // Task 1 made `budgetStudyDate` throw on a missing/blank timezone and
  // `balanceFor` throw on a missing/non-positive dailyMinutes or
  // deviceDailyMinutes, instead of silently defaulting into a UTC day
  // boundary or a NaN balance that never trips depleted. Per the design
  // ruling for gate 3 ("fail open"), the SERVICE must not let either throw
  // reach its caller as a 500: it logs loudly and returns exactly the
  // disabled-feature shape, so a household config typo degrades to
  // unmetered play (visible in the log store) rather than locking a child
  // out of game time they earned.

  it('a missing household timezone degrades to unmetered play, not a 500 (D6 fail-open)', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const noTz = new PianoGameBudgetService({
      store, config: () => CFG, timezone: null, // no household timezone configured
      clock: () => now, idFactory: () => 'sess_notz', logger,
    });

    const openResult = await noTz.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(openResult).toEqual({ enabled: false });
    expect(store.saveDay).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('budget.config-invalid', expect.objectContaining({
      key: 'timezone',
    }));

    const balanceResult = await noTz.balance({ learnerId: 'kid_a' });
    expect(balanceResult).toEqual({ enabled: false });

    const settleResult = await noTz.settle({ sessionId: 'sess_notz', learnerId: 'kid_a', cumulativeSeconds: 30 });
    expect(settleResult).toEqual({ secondsLeft: Infinity, depleted: false, deviceDepleted: false });

    const closeResult = await noTz.close({ sessionId: 'sess_notz', learnerId: 'kid_a', cumulativeSeconds: 30 });
    expect(closeResult).toEqual({ ok: true });
  });

  it('a missing dailyMinutes degrades to unmetered play once open, not a 500 (D5 fail-open)', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const brokenCfg = { enabled: true, deviceDailyMinutes: 120, warnAtMinutes: 5, users: {} }; // dailyMinutes missing
    const badCfg = new PianoGameBudgetService({
      store, config: () => brokenCfg, timezone: 'America/Los_Angeles',
      clock: () => now, idFactory: () => 'sess_badcfg', logger,
    });

    const openResult = await badCfg.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(openResult).toEqual({ enabled: false });
    expect(logger.error).toHaveBeenCalledWith('budget.config-invalid', expect.objectContaining({
      key: 'dailyMinutes',
    }));

    const balanceResult = await badCfg.balance({ learnerId: 'kid_a' });
    expect(balanceResult).toEqual({ enabled: false });

    // The session DID get created by open()'s domain-math step (before the
    // balance computation failed) — settling against it must not throw,
    // and must report the caller as unmetered.
    const settleResult = await badCfg.settle({ sessionId: 'sess_badcfg', learnerId: 'kid_a', cumulativeSeconds: 30 });
    expect(settleResult).toEqual({ secondsLeft: Infinity, depleted: false, deviceDepleted: false });
  });
});
