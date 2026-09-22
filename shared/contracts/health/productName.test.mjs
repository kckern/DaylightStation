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
    // Repeated words are kept: Mahi Mahi, Cous Cous and Yum Yum are real names.
    ['Mahi Mahi', 'Mahi Mahi'],
    ['MAHI MAHI', 'Mahi Mahi'],
    ['COUS COUS', 'Cous Cous'],
    ['Yum Yum Sauce', 'Yum Yum Sauce'],
    ['Sharp Cheddar Cheddar Cheese', 'Sharp Cheddar Cheddar Cheese'],
    // Unicode letters are detected and capitalised.
    ['ÉCLAIRS', 'Éclairs'],
    ['ÉCLAIRS AU CHOCOLAT', 'Éclairs Au Chocolat'],
    // Digit-led tokens are the brand's own spelling.
    ['7UP', '7UP'],
    ['7UP LEMON LIME', '7UP Lemon Lime'],
    // An ampersand is never followed by a lowercased letter.
    ["M&M'S PEANUT", "M&M'S Peanut"],
    // A one-letter prefix before an apostrophe capitalises what follows; a possessive does not.
    ["O'BRIEN POTATOES", "O'Brien Potatoes"],
    ["KELLOGG'S CORN FLAKES", "Kellogg's Corn Flakes"],
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
