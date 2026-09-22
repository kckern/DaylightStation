import { describe, it, expect } from 'vitest';
import { normalizeProductName } from './productName.mjs';

describe('normalizeProductName', () => {
  it.each([
    ['OIKOS PRO PLAIN', 'Oikos Pro Plain'],
    ['PEANUT BUTTER SPREAD', 'Peanut Butter Spread'],
    ['Galbani STRING CHEESE', 'Galbani String Cheese'],
    ['BABY SPINACH', 'Baby Spinach'],
    ['PEELED BABY-CUT CARROTS', 'Peeled Baby-Cut Carrots'],
    ['CORE POWER Chocolate High Protein Milk Shake', 'Core Power Chocolate High Protein Milk Shake'],
    ['MACARONI AND CHEESE', 'Macaroni and Cheese'],
    ['BBQ SAUCE', 'BBQ Sauce'],
    ['Kind PB Bar', 'Kind PB Bar'],
    ['McCormick Pure Vanilla', 'McCormick Pure Vanilla'],
    ['Sharp Cheddar Cheddar Cheese', 'Sharp Cheddar Cheese'],
    ['  Diet coca cola ', 'Diet coca cola'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeProductName(raw)).toBe(expected);
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeProductName(null)).toBe('');
    expect(normalizeProductName(undefined)).toBe('');
  });
});
