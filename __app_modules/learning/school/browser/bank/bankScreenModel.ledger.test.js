import { describe, it, expect } from 'vitest';
import { ledgerEntry, LEDGER_SOURCE_LABELS, NAPPING, coinWord } from './bankScreenModel.js';

const line = (over) => ({ text: 't', at: '2026-10-21T16:00:00.000Z', kind: 'earn', ids: ['e'], ...over });

describe('ledgerEntry', () => {
  it('a payout: signed amount, source word, rule label, balance after in its own coin', () => {
    expect(ledgerEntry(line({ source: 'payout', label: 'Korean (each day done)', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 5, gold: 12, gems: 1 } })))
      .toEqual({ key: 'e', source: 'payout', sourceLabel: 'Earned', label: 'Korean (each day done)', amounts: [{ currency: 'silver', delta: 2, text: '+2 silver' }], sign: 1, balanceText: '5 silver' });
  });

  it('a spend is minus, with a true minus sign', () => {
    const e = ledgerEntry(line({ kind: 'spend', ids: ['s'], source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 3, gold: 12, gems: 1 } }));
    expect(e).toMatchObject({ sourceLabel: 'Spent', sign: -1, balanceText: '3 silver' });
    expect(e.amounts[0].text).toBe('−3 silver');
  });

  it('a conversion shows both legs and both balances', () => {
    const e = ledgerEntry(line({ kind: 'convert', ids: ['g', 'o'], source: 'conversion', label: 'silver → gold',
      legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 6, gold: 12, gems: 1 } }));
    expect(e).toMatchObject({ key: 'g|o', sourceLabel: 'Converted', sign: 0, balanceText: '6 silver · 12 gold' });
    expect(e.amounts.map((a) => a.text)).toEqual(['−12 silver', '+12 gold']);
  });

  it('one gem is singular, in the amount and the balance', () => {
    const e = ledgerEntry(line({ source: 'prize', label: 'Most rings', legs: [{ currency: 'gems', delta: 1 }], balanceAfter: { silver: 0, gold: 0, gems: 1 } }));
    expect(e.amounts[0].text).toBe('+1 gem');
    expect(e.balanceText).toBe('1 gem');
  });

  it('a line from an older server reads as its sentence alone', () => {
    expect(ledgerEntry({ text: '+1 silver · Green day', at: 'x', kind: 'earn', ids: ['x'] }))
      .toEqual({ key: 'x', source: null, sourceLabel: null, label: '+1 silver · Green day', amounts: [], sign: 0, balanceText: null });
  });

  it('every source the server sends has a word', () => {
    for (const s of ['payout', 'earn', 'prize', 'refund', 'spend', 'deposit', 'correction', 'withdraw', 'conversion']) {
      expect(LEDGER_SOURCE_LABELS[s]).toEqual(expect.any(String));
    }
  });

  it('coinWord is exported for reuse: gems pluralise, silver and gold do not', () => {
    expect(coinWord('gems', 1)).toBe('gem');
    expect(coinWord('gems', 2)).toBe('gems');
    expect(coinWord('silver', 1)).toBe('silver');
    expect(coinWord('gold', -1)).toBe('gold');
  });

  it('NAPPING lives in the model, and the bank screen still exports it', async () => {
    const screenModule = await import('./BankScreen.jsx');
    expect(screenModule.NAPPING).toBe(NAPPING);
    expect(NAPPING).toBe('The bank is napping. Try again soon.');
  });
});
