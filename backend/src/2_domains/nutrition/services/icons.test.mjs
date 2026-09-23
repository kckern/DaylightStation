import { describe, it, expect } from 'vitest';
import { confineIcon, iconVocabulary, guessIconForName, NEUTRAL_ICON } from './icons.mjs';
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
  it('refuses the audited ham, eggs, yogurt and chia mismatches without suitable assets', () => {
    const vocabulary = iconVocabulary('bacon-cheeseburger fried-eggs berry-yogurt-parfait berry-chia-pudding');
    expect(confineIcon('bacon-cheeseburger', vocabulary, 'Diced Ham')).toBe('default');
    expect(confineIcon('fried-eggs', vocabulary, 'Scrambled Eggs')).toBe('default');
    expect(confineIcon('berry-yogurt-parfait', vocabulary, 'OIKOS PRO PLAIN')).toBe('default');
    expect(confineIcon('berry-chia-pudding', vocabulary, 'Organic chia seed')).toBe('default');
    const reviewed = iconVocabulary('scrambled-eggs', { 'scrambled eggs': 'scrambled-eggs' });
    expect(confineIcon('fried-eggs', reviewed, 'Scrambled Eggs')).toBe('scrambled-eggs');
  });
});

describe('guessIconForName — the closest offered icon for a name', () => {
  const vocab = iconVocabulary('apple banana fried-eggs strawberry-smoothie smoothie salt-and-pepper-shakers cheddar-wedge cola scrambled-toast',
    { 'diet coke': 'cola', 'mystery bar': null });

  it('matches the longest run of words, head noun first at equal length', () => {
    expect(guessIconForName('Organic Fuji Apple', vocab)).toBe('apple');
    expect(guessIconForName('Strawberry Smoothie', vocab)).toBe('strawberry-smoothie');
    expect(guessIconForName('Fried Egg', vocab)).toBe('fried-eggs');
    expect(guessIconForName('Bananas', vocab)).toBe('banana');
  });

  it('a reviewed alias decides, including an explicit "no suitable art"', () => {
    expect(guessIconForName('Diet Coke', vocab)).toBe('cola');
    expect(guessIconForName('Mystery Bar', vocab)).toBe(NEUTRAL_ICON);
  });

  it('never substring-matches, never matches a lone modifier, never guesses around an exact-only name', () => {
    expect(guessIconForName('Premier Protein Vanilla Shake', vocab)).toBe(NEUTRAL_ICON);
    expect(guessIconForName('Organic', vocab)).toBe(NEUTRAL_ICON);
    expect(guessIconForName('Scrambled Eggs', vocab)).toBe(NEUTRAL_ICON);
    expect(guessIconForName('', vocab)).toBe(NEUTRAL_ICON);
    expect(guessIconForName('Apple', new Set())).toBe(NEUTRAL_ICON);
  });
});
