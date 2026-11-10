import { describe, it, expect } from 'vitest';
import { passRef, parsePassRef, passState, passesOn, findPass, quote, PASS_SELLABLE_COINS, nonePass, capUsed, DEFAULT_MAX_ACTIVE_MS } from './passes.mjs';

const L = 'kid';
const DAY = '2026-10-20';
const REF = `pass:${L}:${DAY}`;
const CATALOG = {
  passes: {
    'early-pass': {
      privileges: ['piano.games'], price: { silver: 3, gold: 1 },
      cap: { per: 'study-day', count: 1, across: 'all-passes' }, authorization: 'trust', refund_within_ms: 60000,
    },
  },
};

const marker = (ref, state, extra = {}) => ({
  id: `m-${ref}`, at: '2026-10-20T15:00:00.000Z', kind: 'pass', currency: 'silver', delta: 0, action: 'early-pass', source: 'pass', ref,
  evidenceRef: REF, meta: { pass: 'early-pass', privilege: 'piano.games', coin: 'silver', price: 3, state, boughtAt: '2026-10-20T15:00:00.000Z', ...extra },
});
const spend = { id: 's', at: '2026-10-20T15:00:00.000Z', kind: 'spend', currency: 'silver', delta: -3, action: 'early-pass', source: 'pass', ref: REF };
const refundEarn = { id: 'r', at: '2026-10-20T15:00:30.000Z', kind: 'earn', currency: 'silver', delta: 3, action: 'early-pass-refund', source: 'pass', ref: `${REF}:refund` };

describe('passRef', () => {
  it('is pass:{learnerId}:{studyDay}; a later pass the same day carries .{seq}', () => {
    expect(passRef({ learnerId: L, studyDay: DAY })).toBe(REF);
    expect(passRef({ learnerId: L, studyDay: DAY, seq: 2 })).toBe(`${REF}.2`);
  });
  it('parses back, including a learner id holding a colon; anything else is null', () => {
    expect(parsePassRef(REF)).toEqual({ learnerId: L, studyDay: DAY, seq: 1 });
    expect(parsePassRef(`pass:a:b:${DAY}.3`)).toEqual({ learnerId: 'a:b', studyDay: DAY, seq: 3 });
    expect(parsePassRef(`${REF}:consumed`)).toBeNull();
    expect(parsePassRef('pass:kid:yesterday')).toBeNull();
    expect(parsePassRef(null)).toBeNull();
  });
});

describe('passState', () => {
  it('none when no purchase marker exists', () => {
    expect(passState([], { learnerId: L, studyDay: DAY })).toMatchObject({ passId: REF, state: 'none', privilege: null, price: null });
  });
  it('nonePass has the same keys as a real pass state', () => {
    const real = passState([marker(REF, 'active'), spend], { learnerId: L, studyDay: DAY });
    const none = nonePass({ learnerId: L, studyDay: DAY, privilege: 'piano.games' });
    expect(none).toMatchObject({ passId: null, state: 'none', privilege: 'piano.games', paid: 0 });
    expect(Object.keys(real).filter((k) => !(k in none))).toEqual([]);
  });
  it('active after the purchase, with the privilege, coin, price and what was paid', () => {
    expect(passState([marker(REF, 'active'), spend], { learnerId: L, studyDay: DAY }))
      .toMatchObject({ state: 'active', privilege: 'piano.games', coin: 'silver', price: 3, paid: 3, boughtAt: '2026-10-20T15:00:00.000Z' });
  });
  it('a purchase marker whose spend never landed is active and unpaid', () => {
    expect(passState([marker(REF, 'active')], { learnerId: L, studyDay: DAY })).toMatchObject({ state: 'active', paid: 0 });
  });
  it('a transition marker ends the pass', () => {
    const txns = [marker(REF, 'active'), spend, marker(`${REF}:consumed`, 'consumed', { playedMs: 120000 })];
    expect(passState(txns, { learnerId: L, studyDay: DAY })).toMatchObject({ state: 'consumed', playedMs: 120000 });
  });
  it('the FIRST transition wins, as the writes do', () => {
    const consumed = marker(`${REF}:consumed`, 'consumed');
    const refunded = marker(`${REF}:refunded`, 'refunded');
    expect(passState([marker(REF, 'active'), spend, consumed, refunded], { learnerId: L, studyDay: DAY }).state).toBe('consumed');
    expect(passState([marker(REF, 'active'), spend, refunded, consumed], { learnerId: L, studyDay: DAY }).state).toBe('refunded');
    // A refund earn is the refund's first write.
    expect(passState([marker(REF, 'active'), spend, refundEarn, consumed], { learnerId: L, studyDay: DAY }).state).toBe('refunded');
  });
  it('a refund earn reads as refunded even before its marker lands', () => {
    expect(passState([marker(REF, 'active'), spend, refundEarn], { learnerId: L, studyDay: DAY }))
      .toMatchObject({ state: 'refunded', refunded: 3 });
  });
  it('ignores markers of another day, learner or sequence', () => {
    const other = marker(`pass:${L}:2026-10-19`, 'active');
    const second = marker(`${REF}.2`, 'active');
    expect(passState([other, second], { learnerId: L, studyDay: DAY }).state).toBe('none');
  });
  it('carries the refund window and the active limit recorded on the purchase', () => {
    const txns = [marker(REF, 'active', { refundWithinMs: 120000, maxActiveMs: 600000 }), spend];
    expect(passState(txns, { learnerId: L, studyDay: DAY })).toMatchObject({ refundWithinMs: 120000, maxActiveMs: 600000 });
  });
  it('an older marker with neither reads no refund window and the default active limit', () => {
    expect(passState([marker(REF, 'active'), spend], { learnerId: L, studyDay: DAY }))
      .toMatchObject({ refundWithinMs: null, maxActiveMs: DEFAULT_MAX_ACTIVE_MS });
    expect(DEFAULT_MAX_ACTIVE_MS).toBe(30 * 60_000);
  });
});

describe('passState: the active limit', () => {
  const bought = Date.parse('2026-10-20T15:00:00.000Z');
  const read = (txns, nowMs) => passState(txns, { learnerId: L, studyDay: DAY, now: nowMs });
  it('an active pass past maxActiveMs reads consumed, reason expired, ended at the limit', () => {
    const txns = [marker(REF, 'active', { maxActiveMs: 600000 }), spend];
    expect(read(txns, bought + 599_999)).toMatchObject({ state: 'active', endedAt: null });
    expect(read(txns, bought + 600_001)).toMatchObject({
      state: 'consumed', reason: 'expired', endedAt: '2026-10-20T15:10:00.000Z', playedMs: null, refunded: 0,
    });
  });
  it('an older marker without the key expires at the default 30 minutes', () => {
    const txns = [marker(REF, 'active'), spend];
    expect(read(txns, bought + 29 * 60_000).state).toBe('active');
    expect(read(txns, bought + 31 * 60_000)).toMatchObject({ state: 'consumed', reason: 'expired' });
  });
  it('a real transition still wins over the limit', () => {
    const txns = [marker(REF, 'active'), spend, refundEarn, marker(`${REF}:refunded`, 'refunded')];
    expect(read(txns, bought + 60 * 60_000).state).toBe('refunded');
  });
  it('without a now, nothing expires (a pure read of the ledger)', () => {
    expect(passState([marker(REF, 'active'), spend], { learnerId: L, studyDay: DAY }).state).toBe('active');
  });
  it('passesOn applies the same limit', () => {
    const txns = [marker(REF, 'active'), spend];
    expect(passesOn(txns, { learnerId: L, studyDay: DAY, now: new Date(bought + 31 * 60_000) })[0].state).toBe('consumed');
  });
});

describe('passesOn', () => {
  it('lists the day\'s passes in sequence order', () => {
    const txns = [marker(REF, 'active'), marker(`${REF}.2`, 'active'), marker(`${REF}:refunded`, 'refunded')];
    expect(passesOn(txns, { learnerId: L, studyDay: DAY }).map((p) => [p.passId, p.state]))
      .toEqual([[REF, 'refunded'], [`${REF}.2`, 'active']]);
  });
});

describe('capUsed', () => {
  const day = (refs) => refs.map((r, i) => ({ passId: r, pass: i === 1 ? 'arcade' : 'early-pass' }));
  it('counts every pass across all-passes, only this pass otherwise', () => {
    expect(capUsed(day([REF]), { key: 'early-pass', def: CATALOG.passes['early-pass'] })).toBe(true);
    expect(capUsed([], { key: 'early-pass', def: CATALOG.passes['early-pass'] })).toBe(false);
    const own = { key: 'early-pass', def: { cap: { per: 'study-day', count: 1, across: 'this-pass' } } };
    expect(capUsed([{ pass: 'arcade' }], own)).toBe(false);
    expect(capUsed([{ pass: 'early-pass' }], own)).toBe(true);
  });
  it('a cap it cannot read is null', () => {
    expect(capUsed([], { key: 'p', def: { cap: { per: 'week' } } })).toBeNull();
  });
});

describe('findPass', () => {
  it('finds the pass listing a privilege, or null', () => {
    expect(findPass(CATALOG, 'piano.games')).toMatchObject({ key: 'early-pass' });
    expect(findPass(CATALOG, 'arcade')).toBeNull();
    expect(findPass({}, 'piano.games')).toBeNull();
  });
});

describe('quote', () => {
  it('offers each coin with a positive price, and whether the balance covers it', () => {
    expect(quote(CATALOG, { privilege: 'piano.games', balances: { silver: 2, gold: 4, gems: 9 } }))
      .toEqual([{ coin: 'silver', price: 3, affordable: false }, { coin: 'gold', price: 1, affordable: true }]);
  });
  it('a price of 0 is not sold in that coin; both at 0 offers nothing', () => {
    const one = { passes: { 'early-pass': { ...CATALOG.passes['early-pass'], price: { silver: 0, gold: 2 } } } };
    expect(quote(one, { privilege: 'piano.games', balances: { gold: 2 } })).toEqual([{ coin: 'gold', price: 2, affordable: true }]);
    const none = { passes: { 'early-pass': { ...CATALOG.passes['early-pass'], price: { silver: 0, gold: 0 } } } };
    expect(quote(none, { privilege: 'piano.games', balances: { silver: 99, gold: 99 } })).toEqual([]);
  });
  it('never sells in gems, a fractional price or an unknown coin', () => {
    const odd = { passes: { p: { privileges: ['x'], price: { silver: 1.5, gems: 1, copper: 2 } } } };
    expect(quote(odd, { privilege: 'x', balances: { silver: 9, gems: 9 } })).toEqual([]);
    expect(PASS_SELLABLE_COINS).toEqual(['silver', 'gold']);
  });
  it('an unlisted privilege has no offers', () => {
    expect(quote(CATALOG, { privilege: 'arcade', balances: {} })).toEqual([]);
  });
});
