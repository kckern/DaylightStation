import { describe, it, expect } from 'vitest';
import { ledgerEntry, NAPPING, coinWord } from './bankScreenModel.js';

const line = (over) => ({ text: 't', at: '2026-10-21T16:00:00.000Z', kind: 'earn', ids: ['e'], ...over });

describe('ledgerEntry — fractional gold', () => {
  it('floors a fractional gold leg and balance: +5.6 reads +5, 10.3 reads 10', () => {
    const e = ledgerEntry(line({ kind: 'convert', ids: ['g', 'o'], source: 'conversion', label: 'silver → gold',
      legs: [{ currency: 'silver', delta: -56 }, { currency: 'gold', delta: 5.6 }], balanceAfter: { silver: 0, gold: 10.3, gems: 0 } }));
    expect(e.amounts.map((a) => a.text)).toEqual(['\u221256 silver', '+5 gold']);
    expect(e.amounts[1].delta).toBe(5.6);
    expect(e.balanceText).toBe('0 silver \u00b7 10 gold');
  });
});

describe('ledgerEntry', () => {
  it('a payout: time, signed amount, label and what it was for, balance after in its own coin', () => {
    const at = '2026-10-21T16:00:00.000Z';
    expect(ledgerEntry(line({ source: 'payout', label: 'Korean', detail: 'Tuesday', legs: [{ currency: 'silver', delta: 2 }], balanceAfter: { silver: 5, gold: 12, gems: 1 } })))
      .toEqual({ key: 'e', source: 'payout', time: new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), label: 'Korean', detail: 'Tuesday', amounts: [{ currency: 'silver', delta: 2, text: '+2 silver' }], sign: 1, balanceText: '5 silver' });
  });

  it('a spend is minus, with a true minus sign', () => {
    const e = ledgerEntry(line({ kind: 'spend', ids: ['s'], source: 'spend', label: 'early pass', legs: [{ currency: 'silver', delta: -3 }], balanceAfter: { silver: 3, gold: 12, gems: 1 } }));
    expect(e).toMatchObject({ label: 'early pass', detail: null, sign: -1, balanceText: '3 silver' });
    expect(e.amounts[0].text).toBe('−3 silver');
  });

  it('a conversion shows both legs and both balances', () => {
    const e = ledgerEntry(line({ kind: 'convert', ids: ['g', 'o'], source: 'conversion', label: 'silver → gold',
      legs: [{ currency: 'silver', delta: -12 }, { currency: 'gold', delta: 12 }], balanceAfter: { silver: 6, gold: 12, gems: 1 } }));
    expect(e).toMatchObject({ key: 'g|o', label: 'silver → gold', sign: 0, balanceText: '6 silver · 12 gold' });
    expect(e.amounts.map((a) => a.text)).toEqual(['−12 silver', '+12 gold']);
  });

  it('one gem is singular, in the amount and the balance', () => {
    const e = ledgerEntry(line({ source: 'prize', label: 'Most rings', legs: [{ currency: 'gems', delta: 1 }], balanceAfter: { silver: 0, gold: 0, gems: 1 } }));
    expect(e.amounts[0].text).toBe('+1 gem');
    expect(e.balanceText).toBe('1 gem');
  });

  it('a line from an older server reads as its sentence alone', () => {
    expect(ledgerEntry({ text: '+1 silver · Green day', at: 'x', kind: 'earn', ids: ['x'] }))
      .toEqual({ key: 'x', source: null, time: null, label: '+1 silver · Green day', detail: null, amounts: [], sign: 0, balanceText: null });
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
