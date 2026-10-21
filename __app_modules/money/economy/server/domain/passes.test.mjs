import { describe, it, expect } from 'vitest';
import { passRef, parsePassRef, passState, passesOn, findPass, quote, PASS_SELLABLE_COINS } from './passes.mjs';

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
  it('active after the purchase, with the privilege, coin, price and what was paid', () => {
    expect(passState([marker(REF, 'active'), spend], { learnerId: L, studyDay: DAY }))
      .toMatchObject({ state: 'active', privilege: 'piano.games', coin: 'silver', price: 3, paid: 3, boughtAt: '2026-10-20T15:00:00.000Z' });
  });
  it('a purchase marker whose spend never landed is active and unpaid', () => {
    expect(passState([marker(REF, 'active')], { learnerId: L, studyDay: DAY })).toMatchObject({ state: 'active', paid: 0 });
  });
  it('the latest transition marker wins', () => {
    const txns = [marker(REF, 'active'), spend, marker(`${REF}:consumed`, 'consumed', { playedMs: 120000 })];
    expect(passState(txns, { learnerId: L, studyDay: DAY })).toMatchObject({ state: 'consumed', playedMs: 120000 });
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
});

describe('passesOn', () => {
  it('lists the day\'s passes in sequence order', () => {
    const txns = [marker(REF, 'active'), marker(`${REF}.2`, 'active'), marker(`${REF}:refunded`, 'refunded')];
    expect(passesOn(txns, { learnerId: L, studyDay: DAY }).map((p) => [p.passId, p.state]))
      .toEqual([[REF, 'refunded'], [`${REF}.2`, 'active']]);
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
