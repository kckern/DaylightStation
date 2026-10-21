import { describe, it, expect } from 'vitest';
import { historyLines, entrySentence } from './historyText.mjs';

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
    expect(entrySentence(tx({ kind: 'spend', delta: -3, action: 'early-pass', ref: 'pass:k:2026-10-20' }), opts)).toBe('−3 silver · early pass');
    expect(entrySentence(tx({ kind: 'spend', currency: 'gold', delta: -1, action: 'early-pass', ref: 'pass:k:2026-10-20' }), opts)).toBe('−1 gold · early pass');
    expect(entrySentence(tx({ kind: 'earn', delta: 3, action: 'early-pass-refund', ref: 'pass:k:2026-10-20:refund' }), opts))
      .toBe('+3 silver · early pass refunded');
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
  it('a lone half still reads', () => {
    expect(texts([out])).toEqual(['−12 silver · converted · Sunday']);
  });
  it('keeps order, newest first as given, and skips the zero-delta pass markers', () => {
    const marker = tx({ id: 'm', kind: 'pass', delta: 0, action: 'early-pass', ref: 'pass:k:2026-10-20' });
    const pay = tx({ id: 'p', kind: 'earn', delta: 2, action: 'payout:scripture-week', ruleId: 'scripture-week', evidenceRef: 'line:isaiah' });
    const sp = tx({ id: 's', kind: 'spend', delta: -3, action: 'early-pass', ref: 'pass:k:2026-10-20' });
    expect(texts([marker, sp, back, out, pay])).toEqual([
      '−3 silver · early pass', '12 silver → 12 gold · Sunday', '+2 silver · Isaiah 50–51 passed',
    ]);
  });
  it('a Map works as the evidence lookup', () => {
    const pay = tx({ kind: 'earn', delta: 2, action: 'payout:r', ruleId: 'r', evidenceRef: 'e' });
    expect(texts([pay], { evidenceLabels: new Map([['e', 'Math 4-02 passed']]) })).toEqual(['+2 silver · Math 4-02 passed']);
  });
});
