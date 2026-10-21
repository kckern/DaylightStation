import { describe, it, expect } from 'vitest';
import { historyLines, entrySentence, entrySource } from './historyText.mjs';
import { foldBalances } from './entities/Transaction.mjs';

const AT = '2026-10-19T06:30:00.000Z'; // Sunday 23:30 in Los Angeles
const tx = (over) => ({ id: over.id ?? 'x', at: AT, kind: 'earn', currency: 'silver', delta: 1, action: 'a', source: 's', ref: null, ...over });
const opts = {
  ruleLabels: { 'scripture-week': 'Scripture (whole week)', 'ring-contest': 'Most rings this week' },
  evidenceLabels: { 'line:isaiah': 'Isaiah 50–51 passed' },
  timezone: 'America/Los_Angeles',
};
const texts = (entries, o = opts) => historyLines(entries, o).map((l) => l.text);

describe('entrySentence', () => {
  it('a payout earn names the evidence line, then the rule label, then a generic phrase', () => {
    expect(entrySentence(tx({ kind: 'earn', delta: 2, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:isaiah' }), opts))
      .toBe('+2 silver · Isaiah 50–51 passed');
    expect(entrySentence(tx({ kind: 'earn', delta: 5, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:old' }), opts))
      .toBe('+5 silver · Scripture (whole week)');
    expect(entrySentence(tx({ kind: 'earn', delta: 1, action: 'payout:gone', ruleId: 'gone' }), opts)).toBe('+1 silver · schoolwork');
  });
  it('a prize', () => {
    expect(entrySentence(tx({ kind: 'prize', currency: 'gems', delta: 1, action: 'payout:ring-contest', ruleId: 'ring-contest' }), opts))
      .toBe('+1 gem · Most rings this week');
    expect(entrySentence(tx({ kind: 'prize', currency: 'gems', delta: 2, action: 'payout:x', ruleId: 'x' }), opts)).toBe('+2 gems · prize');
  });
  it('an early pass and its refund', () => {
    expect(entrySentence(tx({ kind: 'spend', delta: -3, action: 'early-pass', source: 'pass', ref: 'pass:k:2026-10-20' }), opts)).toBe('−3 silver · early pass');
    expect(entrySentence(tx({ kind: 'spend', currency: 'gold', delta: -1, action: 'early-pass', source: 'pass', ref: 'pass:k:2026-10-20' }), opts)).toBe('−1 gold · early pass');
    expect(entrySentence(tx({ kind: 'earn', delta: 3, action: 'early-pass-refund', source: 'pass', ref: 'pass:k:2026-10-20:refund' }), opts))
      .toBe('+3 silver · early pass refunded');
  });
  it('a pass is matched by its source, whatever the catalog key is', () => {
    expect(entrySentence(tx({ kind: 'spend', delta: -2, action: 'arcade-sneak', source: 'pass' }), opts)).toBe('−2 silver · early pass');
    expect(entrySentence(tx({ kind: 'earn', delta: 2, action: 'arcade-sneak-refund', source: 'pass' }), opts)).toBe('+2 silver · early pass refunded');
    // Not a pass: an earn whose action merely ends in -refund.
    expect(entrySentence(tx({ kind: 'earn', delta: 2, action: 'bottle-refund', source: 'api' }), opts)).toBe('+2 silver · bottle refund');
  });
  it('other spends and earns read their action as words', () => {
    expect(entrySentence(tx({ kind: 'spend', delta: -3, action: 'chess-sneak' }), opts)).toBe('−3 silver · chess sneak');
    expect(entrySentence(tx({ kind: 'earn', delta: 5, action: 'piano-lesson-complete' }), opts)).toBe('+5 silver · piano lesson complete');
  });
  it('deposit and adjust, with their note', () => {
    expect(entrySentence(tx({ kind: 'deposit', delta: 10, action: 'parent-deposit' }), opts)).toBe('+10 silver · deposit');
    expect(entrySentence(tx({ kind: 'deposit', delta: 10, action: 'parent-deposit', note: 'birthday' }), opts)).toBe('+10 silver · deposit: birthday');
    expect(entrySentence(tx({ kind: 'adjust', delta: -2, action: 'reward-reconciliation' }), opts)).toBe('−2 silver · correction');
    expect(entrySentence(tx({ kind: 'adjust', delta: 4, action: 'reward-reconciliation', note: 'missed grade' }), opts)).toBe('+4 silver · correction: missed grade');
  });
  it('a legacy entry without a currency is silver', () => {
    const legacy = tx({ kind: 'earn', delta: 5, action: 'piano-lesson-complete' });
    delete legacy.currency;
    expect(entrySentence(legacy, opts)).toBe('+5 silver · piano lesson complete');
  });
});

describe('historyLines', () => {
  const out = tx({ id: 'o', kind: 'convert', currency: 'silver', delta: -12, action: 'week-close', ref: 'close:2026-10-12', evidenceRef: 'close:2026-10-12' });
  const back = tx({ id: 'b', kind: 'convert', currency: 'gold', delta: 12, action: 'week-close', ref: 'close:2026-10-12:gold', evidenceRef: 'close:2026-10-12' });
  it('groups the two halves of a conversion into one sentence, named by the local weekday', () => {
    expect(texts([back, out])).toEqual(['12 silver → 12 gold · Sunday']);
    expect(historyLines([back, out], opts)[0]).toMatchObject({ kind: 'convert', at: AT, ids: ['b', 'o'] });
  });
  it('a repaired pair (the second half written later) still reads as one sentence', () => {
    const repaired = { ...back, at: '2026-10-19T07:30:00.000Z' };
    expect(texts([repaired, out])).toEqual(['12 silver → 12 gold · Sunday']);
  });
  it('halves of different conversions never pair', () => {
    const other = { ...back, evidenceRef: 'close:2026-10-05' };
    expect(texts([other, out])).toHaveLength(2);
  });
  it('a lone half still reads', () => {
    expect(texts([out])).toEqual(['−12 silver · converted · Sunday']);
  });
  it('keeps order, newest first as given, and skips the zero-delta pass markers', () => {
    const marker = tx({ id: 'm', kind: 'pass', delta: 0, action: 'early-pass', ref: 'pass:k:2026-10-20' });
    const pay = tx({ id: 'p', kind: 'earn', delta: 2, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:isaiah' });
    const sp = tx({ id: 's', kind: 'spend', delta: -3, action: 'early-pass', source: 'pass', ref: 'pass:k:2026-10-20' });
    expect(texts([marker, sp, back, out, pay])).toEqual([
      '−3 silver · early pass', '12 silver → 12 gold · Sunday', '+2 silver · Isaiah 50–51 passed',
    ]);
  });
  it('a Map works as the evidence lookup', () => {
    const pay = tx({ kind: 'earn', delta: 2, action: 'payout:r', ruleId: 'r', evidenceRef: 'e' });
    expect(texts([pay], { evidenceLabels: new Map([['e', 'Math 4-02 passed']]) })).toEqual(['+2 silver · Math 4-02 passed']);
  });
});

describe('historyLines: structured fields for the coin window', () => {
  // Newest first, as getHistory returns them.
  const entries = [
    tx({ id: 'e', at: '2026-10-21T16:00:00.000Z', kind: 'earn', delta: 2, action: 'payout:korean-daily', source: 'payout', ruleId: 'korean-daily' }),
    tx({ id: 's', at: '2026-10-20T16:00:00.000Z', kind: 'spend', delta: -3, action: 'early-pass', source: 'pass' }),
    tx({ id: 'g', kind: 'convert', currency: 'gold', delta: 12, action: 'week-close', evidenceRef: 'close:w' }),
    tx({ id: 'o', kind: 'convert', currency: 'silver', delta: -12, action: 'week-close', evidenceRef: 'close:w' }),
    tx({ id: 'd', at: '2026-10-12T16:00:00.000Z', kind: 'deposit', delta: 20, action: 'parent-deposit' }),
  ];
  const o = { ...opts, ruleLabels: { 'korean-daily': 'Korean (each day done)' } };

  it('each line carries its source, label, signed legs and the balance after it', () => {
    const lines = historyLines(entries, o).map(({ source, label, legs, balanceAfter }) => ({ source, label, legs, balanceAfter }));
    expect(lines).toEqual([
      { source: 'payout', label: 'Korean (each day done)', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 7, gold: 12, gems: 0 } },
      { source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 5, gold: 12, gems: 0 } },
      { source: 'conversion', label: 'silver → gold', legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 8, gold: 12, gems: 0 } },
      { source: 'deposit', label: 'deposit', legs: [{ currency: 'silver', delta: 20 }], balanceAfter: { silver: 20, gold: 0, gems: 0 } },
    ]);
  });

  it('the newest line\'s balance is the fold of the whole ledger', () => {
    expect(historyLines(entries, o)[0].balanceAfter).toEqual(foldBalances(entries));
  });

  it('refunds, prizes, plain earns, corrections and withdrawals are named for what they are', () => {
    expect(entrySource(tx({ kind: 'earn', delta: 3, action: 'early-pass-refund', source: 'pass' }))).toBe('refund');
    expect(entrySource(tx({ kind: 'prize', currency: 'gems', delta: 1, action: 'payout:ring-contest', source: 'payout' }))).toBe('payout');
    expect(entrySource(tx({ kind: 'prize', currency: 'gems', delta: 1, action: 'contest' }))).toBe('prize');
    expect(entrySource(tx({ kind: 'earn', delta: 5, action: 'piano-lesson-complete' }))).toBe('earn');
    expect(entrySource(tx({ kind: 'adjust', delta: -2, action: 'reward-reconciliation' }))).toBe('correction');
    expect(entrySource(tx({ kind: 'withdraw', delta: -4, action: 'cash-out' }))).toBe('withdraw');
    expect(entrySource(tx({ kind: 'mystery', delta: 1 }))).toBe('other');
  });

  it('a conversion half with no partner is one leg, worded alone', () => {
    const [line] = historyLines([entries[3]], o);
    expect(line).toMatchObject({ source: 'conversion', label: 'converted', legs: [{ currency: 'silver', delta: -12 }], balanceAfter: { silver: 0, gold: 0, gems: 0 } });
  });
});
