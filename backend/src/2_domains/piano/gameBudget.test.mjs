import { describe, it, expect } from 'vitest';
import {
  budgetStudyDate, emptyDay, applyOpen, applySettle, applyClose, balanceFor,
} from './gameBudget.mjs';

const AT = '2026-08-27T20:00:00.000Z';
const CFG = { dailyMinutes: 45, deviceDailyMinutes: 120, users: { kid_a: { dailyMinutes: 30 } } };

const open = (day, over = {}) => applyOpen(day, {
  sessionId: 'sess_1', learnerId: 'kid_a', deviceId: 'kiosk', at: AT, staleAfterSeconds: 900, ...over,
});

describe('budgetStudyDate', () => {
  it('rolls at the 4am study boundary, not midnight (D6)', () => {
    // 2026-08-28T09:59:00Z is 02:59 in America/Los_Angeles — still the 27th's study day.
    expect(budgetStudyDate('2026-08-28T09:59:00.000Z', 'America/Los_Angeles')).toBe('2026-08-27');
    expect(budgetStudyDate('2026-08-28T12:01:00.000Z', 'America/Los_Angeles')).toBe('2026-08-28');
  });

  it('requires a timezone rather than silently falling back to UTC (D6)', () => {
    expect(() => budgetStudyDate(AT)).toThrow(/timezone/);
    expect(() => budgetStudyDate(AT, '')).toThrow(/timezone/);
    expect(() => budgetStudyDate(AT, null)).toThrow(/timezone/);
  });
});

describe('applySettle — hold-and-settle high-water (D4)', () => {
  it('charges only the newly crossed seconds and is idempotent on retry', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT }));
    const again = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT });
    expect(again.chargedSeconds).toBe(0);                       // exact retry = no-op
    ({ day } = applySettle(again.day, { sessionId: 'sess_1', cumulativeSeconds: 90, at: AT }));
    expect(day.learners.kid_a.totalSeconds).toBe(90);
    expect(day.device.totalSeconds).toBe(90);                   // one transaction, never drift (design)
  });

  it('a cumulative BELOW the recorded high-water charges nothing (client restarted at zero)', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 300, at: AT }));
    const res = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 10, at: AT });
    expect(res.chargedSeconds).toBe(0);
    expect(res.day.sessions.sess_1.cumulativeSeconds).toBe(300); // high-water never regresses
  });

  it('throws on a sessionId absent from the day', () => {
    const day = emptyDay('2026-08-27');
    expect(() => applySettle(day, { sessionId: 'ghost', cumulativeSeconds: 10, at: AT }))
      .toThrow('unknown session');
  });

  // `day.sessions['__proto__']` on a plain object reads back
  // `Object.prototype` itself — truthy, so a bare `if (!s) throw` misses it —
  // and the mutations right after (`s.cumulativeSeconds = ...`) would then
  // land ON `Object.prototype`: every object in the PROCESS inherits that
  // property until restart. `constructor`/`prototype` are the same class of
  // bug via other inherited/own properties. Each must be treated as an
  // unknown session (Object.hasOwn, not truthiness), and — the real
  // assertion — the global Object.prototype must come out clean afterward.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects sessionId %j as unknown rather than reading the prototype chain, and does not pollute Object.prototype',
    (pollutedId) => {
      const day = emptyDay('2026-08-27');
      expect(() => applySettle(day, { sessionId: pollutedId, cumulativeSeconds: 10, at: AT }))
        .toThrow('unknown session');
      // eslint-disable-next-line no-new-object
      expect(({}).cumulativeSeconds).toBeUndefined();
      expect(({}).lastSettleAt).toBeUndefined();
    },
  );
});

describe('applyOpen — one open session per learner, stale adoption (design metering §additions)', () => {
  it('re-opening a FRESH session adopts it and returns the server cumulative', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 120, at: AT }));
    const r = open(day, { sessionId: 'sess_2', at: '2026-08-27T20:03:00.000Z' }); // 180s later < 900
    expect(r.adopted).toBe(true);
    expect(r.sessionId).toBe('sess_1');            // same session — double-spend guard
    expect(r.cumulativeSeconds).toBe(120);         // client seeds from this, not zero
  });

  it('a STALE session is closed at its high-water and a fresh one opens at zero', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 120, at: AT }));
    const r = open(day, { sessionId: 'sess_2', at: '2026-08-27T21:00:00.000Z' }); // 3600s > 900
    expect(r.adopted).toBe(false);
    expect(r.sessionId).toBe('sess_2');
    expect(r.cumulativeSeconds).toBe(0);
    expect(r.day.sessions.sess_1.closed).toBe(true);
    expect(r.day.learners.kid_a.totalSeconds).toBe(120); // the tail was already charged, not lost
  });
});

describe('balanceFor', () => {
  it('per-learner override beats dailyMinutes, and device cap is checked in series (D1)', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 600, at: AT }));
    const b = balanceFor(day, CFG, 'kid_a');
    expect(b.learnerSecondsLeft).toBe(30 * 60 - 600);   // override 30, not 45
    expect(b.deviceSecondsLeft).toBe(120 * 60 - 600);
    expect(b.secondsLeft).toBe(Math.min(b.learnerSecondsLeft, b.deviceSecondsLeft));
  });

  it('an unknown learner has the full default allowance', () => {
    const b = balanceFor(emptyDay('2026-08-27'), CFG, 'kid_b');
    expect(b.learnerSecondsLeft).toBe(45 * 60);
  });
});

describe('balanceFor — misconfiguration must be loud, never silently unlimited', () => {
  it('throws when the learner has no override and dailyMinutes is missing', () => {
    const cfg = { deviceDailyMinutes: 120, users: {} };
    expect(() => balanceFor(emptyDay('2026-08-27'), cfg, 'kid_b')).toThrow('dailyMinutes');
  });

  it('throws when deviceDailyMinutes is missing', () => {
    const cfg = { dailyMinutes: 45, users: {} };
    expect(() => balanceFor(emptyDay('2026-08-27'), cfg, 'kid_b')).toThrow('deviceDailyMinutes');
  });
});

describe('applyClose', () => {
  it('settles the final cumulative then marks closed; further settles throw', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applyClose(day, { sessionId: 'sess_1', cumulativeSeconds: 45, at: AT }));
    expect(day.sessions.sess_1.closed).toBe(true);
    expect(day.learners.kid_a.totalSeconds).toBe(45);
    expect(() => applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT }))
      .toThrow('session closed');
  });

  it('is idempotent: closing an already-closed session is a no-op, not an error (unmount/depletion race)', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applyClose(day, { sessionId: 'sess_1', cumulativeSeconds: 45, at: AT }));
    const again = applyClose(day, { sessionId: 'sess_1', cumulativeSeconds: 999, at: AT });
    expect(again.chargedSeconds).toBe(0);
    expect(again.day.learners.kid_a.totalSeconds).toBe(45); // the second call's cumulative is ignored
  });

  it('throws on a sessionId absent from the day', () => {
    const day = emptyDay('2026-08-27');
    expect(() => applyClose(day, { sessionId: 'ghost', cumulativeSeconds: 10, at: AT }))
      .toThrow('unknown session');
  });

  // Same prototype-pollution vector as applySettle (see that describe block
  // for the full explanation) — applyClose reads `day.sessions[sessionId]`
  // directly too, so it needs the identical Object.hasOwn guard.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects sessionId %j as unknown rather than reading the prototype chain, and does not pollute Object.prototype',
    (pollutedId) => {
      const day = emptyDay('2026-08-27');
      expect(() => applyClose(day, { sessionId: pollutedId, cumulativeSeconds: 10, at: AT }))
        .toThrow('unknown session');
      // eslint-disable-next-line no-new-object
      expect(({}).cumulativeSeconds).toBeUndefined();
      expect(({}).closed).toBeUndefined();
    },
  );
});
