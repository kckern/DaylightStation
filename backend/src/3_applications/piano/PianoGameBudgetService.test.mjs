import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PianoGameBudgetService } from './PianoGameBudgetService.mjs';
import { YamlPianoGameBudgetStore } from '../../1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs';
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

  it('a settle that CROSSES the boundary lands on the new day and charges ONLY the post-boundary delta', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, timezone: 'America/Los_Angeles',
      clock: () => now, idFactory: () => 'sess_x', logger,
    });
    await svc2.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    // Spend 90s BEFORE the boundary — this lands on, and stays on, yesterday.
    await svc2.settle({ sessionId: 'sess_x', learnerId: 'kid_a', cumulativeSeconds: 90 });
    expect(store._days.get('2026-08-27').learners.kid_a.totalSeconds).toBe(90);

    now = new Date('2026-08-28T12:30:00.000Z'); // 05:30 LA — the study day has rolled
    // The client's cumulative keeps climbing from the same running total —
    // it does not reset to zero just because the day did.
    await svc2.settle({ sessionId: 'sess_x', learnerId: 'kid_a', cumulativeSeconds: 150 });

    // The carried session seeds today at the high-water it already held
    // (90), so only the 60s spent AFTER the boundary (150 - 90) is charged
    // to the fresh day. A carry that seeded at 0 instead would charge the
    // full 150 again here — this is the assertion that catches that bug.
    expect(store._days.has('2026-08-28')).toBe(true);
    expect(store._days.get('2026-08-28').learners.kid_a.totalSeconds).toBe(60);
    expect(store._days.get('2026-08-27').learners.kid_a.totalSeconds).toBe(90); // untouched
    expect(logger.info).toHaveBeenCalledWith('budget.day-rollover', expect.objectContaining({
      learnerId: 'kid_a', from: '2026-08-27', to: '2026-08-28', cumulativeSeconds: 90,
    }));
  });

  it('two settles across the 4am boundary land in TWO day FILES on disk, one per study day', async () => {
    // The same crossing as the test above, run against the REAL yaml store
    // rather than the in-memory fake. `budget.day-rollover` has no durable
    // home of its own — the day boundary is recorded by which FILE a charge
    // lands in, so that is the thing worth asserting. A fake Map keyed by
    // study date cannot fail the way this can: a store that folded both days
    // into one file, or derived its filename from the wall clock instead of
    // the record's own studyDate, would satisfy the Map assertions and lose a
    // day of history on disk.
    const root = mkdtempSync(path.join(tmpdir(), 'piano-budget-rollover-'));
    const yamlStore = new YamlPianoGameBudgetStore({
      historyRoot: root, logger: { warn: () => {}, error: () => {} },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store: yamlStore, config: () => CFG, timezone: 'America/Los_Angeles',
      clock: () => now, idFactory: () => 'sess_disk', logger,
    });

    now = new Date('2026-08-28T09:30:00.000Z'); // 02:30 LA — still the Aug-27 study day
    await svc2.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await svc2.settle({ sessionId: 'sess_disk', learnerId: 'kid_a', cumulativeSeconds: 90 });

    now = new Date('2026-08-28T12:30:00.000Z'); // 05:30 LA — past the 4am boundary
    await svc2.settle({ sessionId: 'sess_disk', learnerId: 'kid_a', cumulativeSeconds: 150 });

    // Exactly two files, named for the two study days — not one file, and not
    // a third from the UTC date (which was 2026-08-28 for BOTH settles; a UTC
    // bucketing bug would collapse them into one file and read as correct).
    expect(readdirSync(root).sort()).toEqual(['2026-08-27.yml', '2026-08-28.yml']);
    expect(yamlStore.loadDay('2026-08-27').learners.kid_a.totalSeconds).toBe(90);
    expect(yamlStore.loadDay('2026-08-28').learners.kid_a.totalSeconds).toBe(60);
    // Yesterday's session is sealed where it lived; today's continues.
    expect(yamlStore.loadDay('2026-08-27').sessions.sess_disk.closed).toBe(true);
    expect(yamlStore.loadDay('2026-08-28').sessions.sess_disk.closed).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('budget.day-rollover', expect.objectContaining({
      from: '2026-08-27', to: '2026-08-28',
    }));
  });

  it('a settle that crosses the boundary in a UTC-9 timezone still carries to the right day', async () => {
    // Regression for the round-trip date-math bug: an earlier #carryForward
    // anchored "yesterday" at `${today}T12:00:00Z` minus 24h and re-derived
    // the study date from THAT instant through budgetStudyDate, rather than
    // subtracting one calendar day from `today` directly. Two stacked
    // offsets (the fixed noon anchor, and the household's own UTC offset)
    // only cancel out to "exactly one day earlier" for a bounded range of
    // timezones — empirically verified against these exact instants:
    // America/Los_Angeles (used by the boundary test above) round-tripped
    // correctly, but America/Anchorage (UTC-9 AKST) did not: the old
    // formula resolved "yesterday" as 2026-01-14 when the session it needed
    // to find actually opened on 2026-01-15, so the carry silently failed
    // to find it and `settle` would have thrown "unknown session". Pure
    // calendar-string subtraction has no offset in it, so no timezone can
    // land outside its "safe range" — there isn't one.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, timezone: 'America/Anchorage',
      clock: () => now, idFactory: () => 'sess_akst', logger,
    });
    now = new Date('2026-01-15T20:00:00.000Z'); // inside the Jan-15 AKST study day
    await svc2.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    now = new Date('2026-01-16T13:00:00.000Z'); // the AKST study day has rolled to Jan-16
    await svc2.settle({ sessionId: 'sess_akst', learnerId: 'kid_a', cumulativeSeconds: 60 });
    expect(store._days.has('2026-01-16')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('budget.day-rollover', expect.objectContaining({
      learnerId: 'kid_a', from: '2026-01-15', to: '2026-01-16',
    }));
  });

  it('close() also carries a pre-boundary session forward instead of throwing "unknown session"', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, timezone: 'America/Los_Angeles',
      clock: () => now, idFactory: () => 'sess_close', logger,
    });
    await svc2.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await svc2.settle({ sessionId: 'sess_close', learnerId: 'kid_a', cumulativeSeconds: 90 });

    now = new Date('2026-08-28T12:30:00.000Z'); // study day has rolled since the last settle
    const r = await svc2.close({ sessionId: 'sess_close', learnerId: 'kid_a', cumulativeSeconds: 150 });

    expect(r).toEqual({ ok: true });
    expect(store._days.has('2026-08-28')).toBe(true);
    expect(store._days.get('2026-08-28').learners.kid_a.totalSeconds).toBe(60); // only the tail segment
    expect(store._days.get('2026-08-28').sessions.sess_close.closed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('budget.day-rollover', expect.objectContaining({
      learnerId: 'kid_a', from: '2026-08-27', to: '2026-08-28',
    }));
  });

  it('settle rejects a sessionId/learnerId mismatch instead of reporting the wrong allowance', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    // sess_1 belongs to kid_a; claiming it for kid_b must not silently
    // compute/report kid_b's balance for kid_a's session.
    await expect(svc.settle({ sessionId: 'sess_1', learnerId: 'kid_b', cumulativeSeconds: 30 }))
      .rejects.toThrow('session belongs to a different learner');
  });

  it('close rejects a sessionId/learnerId mismatch too, not just settle', async () => {
    // close() has no ownership check of its own in applyClose (it only
    // resolves the session by sessionId), so the caller-claimed learnerId
    // must be validated before acting — the HTTP layer takes learnerId from
    // a client-supplied URL param, so without this a caller who knows a
    // sibling's sessionId could seal (prematurely end) their still-open
    // session.
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await expect(svc.close({ sessionId: 'sess_1', learnerId: 'kid_b', cumulativeSeconds: 30 }))
      .rejects.toThrow('session belongs to a different learner');
    // Nothing was charged or sealed by the rejected attempt.
    expect(store._days.get('2026-08-27').sessions.sess_1.closed).toBe(false);
    expect(store._days.get('2026-08-27').learners.kid_a?.totalSeconds ?? 0).toBe(0);
  });

  it('a mismatched learnerId across the boundary is rejected WITHOUT stranding the real session', async () => {
    // #carryForward's first write seals yesterday's session (closed: true)
    // before today's record even exists. If the ownership check ran AFTER
    // that seal, a mismatched request landing right at the boundary would
    // close the true owner's session on yesterday, write nothing to today,
    // then throw — and the real owner's next (legitimate) settle would find
    // nothing to carry and 500 with "unknown session". The check must run
    // before the seal, so the bad request throws but the session survives
    // untouched for the real owner to continue.
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 90 });

    now = new Date('2026-08-28T12:30:00.000Z'); // study day has rolled

    // A mismatched claim arrives first, right at the boundary.
    await expect(svc.settle({ sessionId: 'sess_1', learnerId: 'kid_b', cumulativeSeconds: 150 }))
      .rejects.toThrow('session belongs to a different learner');

    // Nothing was written: yesterday's session is untouched (not sealed),
    // and today's file was never created.
    expect(store._days.get('2026-08-27').sessions.sess_1.closed).toBe(false);
    expect(store._days.has('2026-08-28')).toBe(false);

    // The real owner's settle — same sessionId, same post-boundary instant —
    // must still succeed and carry forward normally.
    const r = await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 150 });
    expect(r).toEqual({ secondsLeft: 45 * 60 - 60, depleted: false, deviceDepleted: false });
    expect(store._days.has('2026-08-28')).toBe(true);
    expect(store._days.get('2026-08-28').learners.kid_a.totalSeconds).toBe(60); // only the post-boundary delta
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
    // secondsLeft must be a finite number, not Infinity: this response is
    // JSON-serialized over HTTP, JSON.stringify(Infinity) is `null`, and a
    // meter checking `secondsLeft <= 0` would read null as depleted —
    // inverting the whole point of failing open.
    expect(settleResult).toEqual({ secondsLeft: Number.MAX_SAFE_INTEGER, depleted: false, deviceDepleted: false });
    expect(Number.isFinite(settleResult.secondsLeft)).toBe(true);

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
    // secondsLeft must be a finite number, not Infinity: this response is
    // JSON-serialized over HTTP, JSON.stringify(Infinity) is `null`, and a
    // meter checking `secondsLeft <= 0` would read null as depleted —
    // inverting the whole point of failing open.
    expect(settleResult).toEqual({ secondsLeft: Number.MAX_SAFE_INTEGER, depleted: false, deviceDepleted: false });
    expect(Number.isFinite(settleResult.secondsLeft)).toBe(true);
  });
});
