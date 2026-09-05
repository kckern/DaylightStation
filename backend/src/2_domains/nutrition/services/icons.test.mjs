import { describe, it, expect } from 'vitest';
import { confineIcon, iconVocabulary } from './icons.mjs';
describe('reviewed food icon matches', () => {
  it('refuses the observed condiment and whipped-cream mismatches', () => {
    const vocabulary = iconVocabulary('condiments whipped-cream flour-tortilla');
    expect(confineIcon('condiments', vocabulary, 'Ranch Dressing')).toBe('default');
    expect(confineIcon('whipped-cream', vocabulary, 'Cream Sauce')).toBe('default');
    expect(confineIcon('flour-tortilla', vocabulary, 'Fish Taco')).toBe('default');
  });
  it('honors reviewed food aliases, including explicit no-match', () => {
    const vocabulary = iconVocabulary('cod sauce', { 'white fish': 'cod', 'cream sauce': null });
    expect(confineIcon('default', vocabulary, 'White Fish')).toBe('cod');
    expect(confineIcon('sauce', vocabulary, 'Cream Sauce')).toBe('default');
  });
});
