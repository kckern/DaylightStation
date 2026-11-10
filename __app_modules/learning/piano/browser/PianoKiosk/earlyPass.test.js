import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));

import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import {
  canBuyPass, canEnterLock, consumePass, errorBody, nextSheetLabel, offersFromBank, refundPass, schoolProgress, passCapUsed,
} from './earlyPass.js';

const access = (pass, offers = [{ coin: 'silver', price: 3, affordable: true }]) => ({
  status: 'ready', state: 'incomplete', unlocked: false, pass, offers,
});

describe('earlyPass', () => {
  it('reads the JSON body a DaylightAPI error carries', () => {
    const error = new Error('HTTP 402: Payment Required - {"code":"PASS_UNAFFORDABLE","shortfall":2}');
    expect(errorBody(error)).toEqual({ code: 'PASS_UNAFFORDABLE', shortfall: 2 });
    expect(errorBody(new Error('Network error: offline'))).toBeNull();
    expect(errorBody(new Error('HTTP 500: x - not json'))).toBeNull();
  });

  it('sells only when school is incomplete, the cap is free, and the child can afford it', () => {
    expect(canBuyPass(access({ state: 'none', capUsed: false }))).toBe(true);
    expect(canBuyPass(access({ state: 'none', capUsed: false }, [{ coin: 'silver', price: 3, affordable: false }]))).toBe(false);
    expect(canBuyPass(access({ state: 'consumed', capUsed: true }))).toBe(false);
    expect(canBuyPass(access({ state: 'unknown', capUsed: null }))).toBe(false);
    expect(canBuyPass(access({ state: 'active', capUsed: true }))).toBe(false);
    expect(canBuyPass({ ...access({ state: 'none', capUsed: false }), state: 'indeterminate' })).toBe(false);
    expect(canBuyPass({ ...access({ state: 'none', capUsed: false }), status: 'error' })).toBe(false);
  });

  it('calls the sneak used only when the ledger says so', () => {
    expect(passCapUsed(access({ state: 'refunded', capUsed: true }))).toBe(true);
    expect(passCapUsed(access({ state: 'unknown', capUsed: null }))).toBe(false);
    expect(passCapUsed(access({ state: 'active', capUsed: true }))).toBe(false);
    expect(passCapUsed(access({ state: 'none', capUsed: false }))).toBe(false);
  });

  it('lets a locked child reach the lock whenever the cap is free, affordable or not', () => {
    expect(canEnterLock(access({ state: 'none', capUsed: false }, []))).toBe(true);
    expect(canEnterLock(access({ state: 'none', capUsed: false }, [{ coin: 'silver', price: 3, affordable: false }]))).toBe(true);
    expect(canEnterLock(access({ state: 'consumed', capUsed: true }))).toBe(false);
    expect(canEnterLock(access({ state: 'unknown', capUsed: null }))).toBe(false);
    expect(canEnterLock(access(null))).toBe(false);
    expect(canEnterLock({ ...access({ state: 'none', capUsed: false }), state: 'indeterminate' })).toBe(false);
  });

  it('prefers the body DaylightAPI attaches', () => {
    expect(errorBody(Object.assign(new Error('HTTP 409: Conflict'), { body: { code: 'PASS_CAP' } }))).toEqual({ code: 'PASS_CAP' });
  });

  it('drops offers when the ledger could not be read', () => {
    const bank = { pass: { 'piano.games': { state: 'unknown' } }, offers: { 'piano.games': [{ coin: 'silver', price: 3, affordable: true }] } };
    expect(offersFromBank(bank)).toEqual([]);
    expect(offersFromBank({ ...bank, pass: { 'piano.games': { state: 'none' } } })).toHaveLength(1);
    expect(offersFromBank({})).toEqual([]);
    // A price of 0 means not sold in that coin (the shipped config): no row.
    const zero = { pass: { 'piano.games': { state: 'none' } }, offers: { 'piano.games': [{ coin: 'silver', price: 0, affordable: true }, { coin: 'gold', price: 2, affordable: false }] } };
    expect(offersFromBank(zero)).toEqual([{ coin: 'gold', price: 2, affordable: false }]);
  });

  it('labels the next sheet without inventing a reward', () => {
    const next = { unit: { unitId: 'm-4-02', title: 'Math 4-02' }, printable: true, reward: null };
    expect(nextSheetLabel(next)).toBe('Print my next sheet (Math 4-02)');
    expect(nextSheetLabel({ ...next, reward: { silver: 2 } })).toBe('Print my next sheet (+2 silver · Math 4-02)');
    expect(nextSheetLabel({ ...next, reward: { silver: 2, gems: 1 } })).toBe('Print my next sheet (+2 silver · +1 gem · Math 4-02)');
    expect(nextSheetLabel({ ...next, reward: { gems: 2 } })).toBe('Print my next sheet (+2 gems · Math 4-02)');
    expect(nextSheetLabel({ ...next, printable: false })).toBeNull();
    expect(nextSheetLabel(null)).toBeNull();
  });

  it('counts served against served plus obligated', () => {
    expect(schoolProgress({ sections: [{ state: 'served' }, { state: 'obligated' }, { state: 'excused' }] })).toEqual({ done: 1, total: 2 });
    expect(schoolProgress({ sections: [{ state: 'excused' }] })).toBeNull();
  });

  it('encodes the pass id, colons and all', async () => {
    await consumePass('kid one', 'pass:kid one:2026-10-21.2', 61000);
    await refundPass('kid one', 'pass:kid one:2026-10-21.2', 1000, 'exit');
    expect(DaylightAPI.mock.calls).toEqual([
      ['api/v1/economy/users/kid%20one/passes/pass%3Akid%20one%3A2026-10-21.2/consume', { playedMs: 61000 }, 'POST'],
      ['api/v1/economy/users/kid%20one/passes/pass%3Akid%20one%3A2026-10-21.2/refund', { playedMs: 1000, reason: 'exit' }, 'POST'],
    ]);
  });
});
