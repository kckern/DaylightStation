import { describe, it, expect } from 'vitest';
import { createTransaction, foldBalance, foldBalances, CURRENCIES } from "./Transaction.mjs";

const AT = '2026-10-19T12:00:00.000Z';
const base = (over) => ({ id: 'txn_x', kind: 'earn', delta: 2, action: 'x', source: 'test', at: AT, ...over });

describe('createTransaction', () => {
  it('builds a stamped transaction with generated id', () => {
    const t = createTransaction({ id: 'txn_fixed', kind: 'earn', delta: 5, action: 'piano-lesson-complete', source: 'piano', ref: 'plex:123', at: '2026-08-28T00:00:00.000Z' });
    expect(t.id).toBe('txn_fixed');
    expect(t.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.kind).toBe('earn');
    expect(t.delta).toBe(5);
  });
  it('rejects sign/kind mismatch', () => {
    expect(() => createTransaction({ kind: 'earn', delta: -5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'spend', delta: 3, action: 'x', source: 'test' })).toThrow();
  });
  it('rejects non-integer and zero deltas and unknown kinds', () => {
    expect(() => createTransaction({ kind: 'earn', delta: 1.5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'earn', delta: 0, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'bogus', delta: 1, action: 'x', source: 'test' })).toThrow();
  });
});

describe('currency and the new kinds', () => {
  it('lists silver, gold and gems', () => {
    expect(CURRENCIES).toEqual(['silver', 'gold', 'gems']);
  });
  it('defaults to silver and stamps the currency on the entry', () => {
    expect(createTransaction(base()).currency).toBe('silver');
    expect(createTransaction(base({ currency: 'gems' })).currency).toBe('gems');
  });
  it('rejects a currency outside the list', () => {
    expect(() => createTransaction(base({ currency: 'copper' }))).toThrow(/currency/);
    expect(() => createTransaction(base({ currency: null }))).toThrow(/currency/);
  });
  it('a pass is a zero-delta voucher marker', () => {
    const t = createTransaction(base({ kind: 'pass', delta: 0, action: 'early-pass', price: { silver: 3 } }));
    expect(t.delta).toBe(0);
    expect(t.price).toEqual({ silver: 3 });
    expect(() => createTransaction(base({ kind: 'pass', delta: 1 }))).toThrow();
  });
  it('every other kind rejects a zero delta', () => {
    for (const kind of ['deposit', 'earn', 'prize', 'spend', 'withdraw', 'adjust', 'convert']) {
      expect(() => createTransaction(base({ kind, delta: 0 }))).toThrow(/delta/);
    }
  });
  it('a prize (the weekly ring contest) is positive-only, like an earn', () => {
    expect(createTransaction(base({ kind: 'prize', delta: 5, currency: 'gems' })).kind).toBe('prize');
    expect(() => createTransaction(base({ kind: 'prize', delta: -5 }))).toThrow(/sign/);
  });
  it('convert takes either sign (the paired entries of one conversion)', () => {
    expect(createTransaction(base({ kind: 'convert', delta: -12, currency: 'silver' })).delta).toBe(-12);
    expect(createTransaction(base({ kind: 'convert', delta: 12, currency: 'gold' })).delta).toBe(12);
  });
  it('keeps the optional earning fields only when set', () => {
    const plain = createTransaction(base());
    for (const key of ['ruleId', 'price', 'timeliness', 'evidenceRef', 'meta']) expect(plain).not.toHaveProperty(key);
    const full = createTransaction(base({ ruleId: 'green-day', timeliness: 'on-time', evidenceRef: 'unit:u1', meta: { week: '2026-W42' } }));
    expect(full).toMatchObject({ ruleId: 'green-day', timeliness: 'on-time', evidenceRef: 'unit:u1', meta: { week: '2026-W42' } });
  });
});

describe('foldBalances', () => {
  it('folds each currency separately; an entry without a currency is silver', () => {
    expect(foldBalances([
      { delta: 5 }, { delta: 3, currency: 'silver' }, { delta: 2, currency: 'gold' }, { delta: 1, currency: 'gems' },
      { delta: -4, currency: 'silver', kind: 'convert' }, { delta: 4, currency: 'gold', kind: 'convert' },
      { delta: 0, currency: 'silver', kind: 'pass' },
    ])).toEqual({ silver: 4, gold: 6, gems: 1 });
  });
  it('floors each currency at zero on its own', () => {
    expect(foldBalances([{ delta: -3, currency: 'gold' }, { delta: 2 }])).toEqual({ silver: 2, gold: 0, gems: 0 });
    expect(foldBalances(undefined)).toEqual({ silver: 0, gold: 0, gems: 0 });
  });
  it('foldBalance stays the silver figure', () => {
    expect(foldBalance([{ delta: 5 }, { delta: 9, currency: 'gold' }])).toBe(5);
  });
});

describe('foldBalance', () => {
  it('sums deltas, never below zero reporting', () => {
    expect(foldBalance([{ delta: 5 }, { delta: 3 }, { delta: -2 }])).toBe(6);
    expect(foldBalance([])).toBe(0);
  });
  it('clamps a negative net to zero (never reports overdraft)', () => {
    expect(foldBalance([{ delta: 5 }, { delta: -9 }])).toBe(0);
  });
});
