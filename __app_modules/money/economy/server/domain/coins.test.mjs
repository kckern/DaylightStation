import { describe, it, expect } from 'vitest';
import { convertedAmount, quantize, sumCoins, displayCoins, displayCoinsText, isCoinDelta } from './coins.mjs';
import { coinFigure, coinMagnitude, coinMagnitudeText, coinsShort } from '../../../../../frontend/src/lib/coins/coinFigure.js';

describe('coins', () => {
  it('silver → gold at 0.1 is exact: 56 silver is 5.6 gold, 3 is 0.3', () => {
    expect(convertedAmount(56, 0.1, 'gold')).toBe(5.6);
    expect(convertedAmount(3, 0.1, 'gold')).toBe(0.3);
    expect(convertedAmount(0, 0.1, 'gold')).toBe(0);
  });
  it('a whole-coin target still floors (and absorbs 0.29 × 100)', () => {
    expect(convertedAmount(56, 0.1, 'gems')).toBe(5);
    expect(convertedAmount(100, 0.29)).toBe(29);
  });
  it('quantize snaps gold to 6 places and leaves silver alone', () => {
    expect(quantize('gold', 5.6 + 4.7)).toBe(10.3);
    expect(quantize('gold', -0.0000001)).toBe(0);
    expect(quantize('silver', 3)).toBe(3);
  });
  it('sumCoins adds gold in micro-units', () => {
    expect(sumCoins('gold', [5.6, 4.7])).toBe(10.3);
    expect(sumCoins('gold', Array(10).fill(0.1))).toBe(1);
    expect(sumCoins('silver', [1, 2])).toBe(3);
  });
  it('isCoinDelta: whole for silver/gems, any non-zero grid figure for gold', () => {
    expect(isCoinDelta('gold', 0.7)).toBe(true);
    expect(isCoinDelta('silver', 0.7)).toBe(false);
    expect(isCoinDelta('gems', 2)).toBe(true);
  });
  it('display floors, server and browser alike', () => {
    for (const [n, shown] of [[5.6, 5], [10.3, 10], [0.7, 0], [12, 12], [NaN, 0]]) {
      expect(displayCoins(n)).toBe(shown);
      expect(coinFigure(n)).toBe(shown);
    }
    expect(coinMagnitude(-5.6)).toBe(5);
    expect(coinsShort(6, 5.6)).toBe(1);
    expect(coinsShort(5, 5.6)).toBe(0);
    expect(coinsShort(3, 1)).toBe(2);
  });
  it('a negative rounds toward zero, never below its size, never -0', () => {
    for (const [n, shown] of [[-0.4, 0], [-5.6, -5], [-1, -1], [-0.0000001, 0], [-3, -3]]) {
      expect(displayCoins(n)).toBe(shown);
      expect(coinFigure(n)).toBe(shown);
      expect(Object.is(coinFigure(n), -0)).toBe(false);
      expect(Object.is(displayCoins(n), -0)).toBe(false);
    }
  });
  it('under one coin reads "less than 1" / "<1", never 0; otherwise the floor', () => {
    for (const [n, words, short] of [[0.6, 'less than 1', '<1'], [-0.6, 'less than 1', '<1'], [5.6, '5', '5'], [0, '0', '0'], [1, '1', '1'], [NaN, '0', '0']]) {
      expect(displayCoinsText(n)).toBe(words);
      expect(displayCoinsText(n, { short: true })).toBe(short);
      expect(coinMagnitudeText(n)).toBe(short);
    }
  });
});
