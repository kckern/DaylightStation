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

describe('historyLines: what a payout was for', () => {
  const pay = (over) => tx({ kind: 'earn', action: `payout:${over.ruleId}`, source: 'payout', ...over });
  const o = { ...opts, ruleLabels: { 'korean-daily': 'Korean (each day done)', rings: 'Rings', 'green-day': 'Green day' } };
  it('a per-day payout names the days it paid, not the days an older entry of the same ref paid', () => {
    const ref = 'earn:kid:korean-daily:2026-10-19:on-time';
    const first = pay({ id: '1', ruleId: 'korean-daily', ref, delta: 4, meta: { kind: 'section-day', count: 2, days: ['2026-10-19', '2026-10-20'] } });
    const second = pay({ id: '2', ruleId: 'korean-daily', ref, delta: 2, meta: { kind: 'section-day', count: 3, days: ['2026-10-19', '2026-10-20', '2026-10-21'] } });
    const lines = historyLines([second, first], o);
    expect(lines.map((l) => l.text)).toEqual(['+2 silver · Korean · Wednesday', '+4 silver · Korean · Monday, Tuesday']);
    expect(lines[0]).toMatchObject({ label: 'Korean', detail: 'Wednesday' });
  });
  it('a ring payout says the week\'s rings when it paid', () => {
    const line = historyLines([pay({ ruleId: 'rings', ref: 'r', delta: 4, meta: { kind: 'ring-threshold', count: 1240 } })], o)[0];
    expect(line).toMatchObject({ text: '+4 silver · Rings · 1,240 this week', label: 'Rings', detail: '1,240 this week' });
  });
  it('a per-workout ring payout names the workout, its local start time and its rings; untitled reads Workout', () => {
    const titled = pay({ ruleId: 'rings', ref: 'r', delta: 6, meta: { kind: 'ring-threshold', count: 622,
      session: { id: '20261021191956', title: 'Sonic & Sega All Stars Racing', startMs: Date.parse('2026-10-22T02:19:56Z'), rings: 588 } } });
    const untitled = pay({ ruleId: 'rings', ref: 'r', delta: 1, meta: { kind: 'ring-threshold', count: 34,
      session: { id: '20261021180513', title: null, startMs: Date.parse('2026-10-22T01:05:13Z'), rings: 34 } } });
    expect(historyLines([titled, untitled], o).map((l) => l.text)).toEqual([
      '+6 silver · Rings · Sonic & Sega All Stars Racing · 7:19 pm · 588 rings',
      '+1 silver · Rings · Workout · 6:05 pm · 34 rings',
    ]);
  });
  it('an entry minted before meta reads as its label alone', () => {
    const line = historyLines([pay({ ruleId: 'korean-daily', ref: 'k', delta: 2 })], o)[0];
    expect(line).toMatchObject({ text: '+2 silver · Korean (each day done)', label: 'Korean (each day done)', detail: null });
  });
});

describe('fractional gold', () => {
  const close = (week, silver, gold, at) => [
    tx({ id: `${week}:gold`, at, kind: 'convert', currency: 'gold', delta: gold, action: 'week-close', source: 'week-close', ref: `close:k:${week}:gold`, evidenceRef: `close:k:${week}` }),
    tx({ id: `${week}:silver`, at, kind: 'convert', currency: 'silver', delta: -silver, action: 'week-close', source: 'week-close', ref: `close:k:${week}`, evidenceRef: `close:k:${week}` }),
  ];
  // Newest first, as getHistory returns them.
  const entries = [
    ...close('2026-10-12', 47, 4.7, '2026-10-19T06:30:00.000Z'),
    tx({ id: 'e2', at: '2026-10-15T16:00:00.000Z', delta: 47 }),
    ...close('2026-10-05', 56, 5.6, '2026-10-12T06:30:00.000Z'),
    tx({ id: 'e1', at: '2026-10-08T16:00:00.000Z', delta: 56 }),
  ];

  it('a sentence shows whole gold (floored); the legs keep the exact figure', () => {
    const [newest, , older] = historyLines(entries, opts);
    expect(newest.text).toBe('47 silver → 4 gold · Sunday');
    expect(older.text).toBe('56 silver → 5 gold · Sunday');
    expect(newest.legs).toEqual([{ currency: 'silver', delta: -47 }, { currency: 'gold', delta: 4.7 }]);
    expect(entrySentence(tx({ kind: 'convert', currency: 'gold', delta: 5.6 }), opts)).toBe('+5 gold · from a conversion · Sunday');
  });

  it('the balance after accumulates gold exactly (5.6 + 4.7 = 10.3)', () => {
    const lines = historyLines(entries, opts);
    expect(lines[0].balanceAfter).toEqual({ silver: 0, gold: 10.3, gems: 0 });
    expect(lines[0].balanceAfter).toEqual(foldBalances(entries));
    expect(lines[2].balanceAfter.gold).toBe(5.6);
  });
});
