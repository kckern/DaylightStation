import { describe, it, expect } from 'vitest';
import { summarizeDayQuality } from './dayQuality.js';

const row = over => ({ kind: 'item', item: 'Brown Rice', mealTime: 'afternoon', icon: 'brown-rice', grams: 180, calories: 210, ...over });

describe('summarizeDayQuality', () => {
  it('reports nothing for a clean day', () => {
    expect(summarizeDayQuality([row()]).issues).toBe(0);
  });
  it('names the rows that will render as gaps', () => {
    const s = summarizeDayQuality([
      { kind: 'group', item: 'Plate', grams: null, calories: 0 },
      row({ item: 'Magazine', icon: 'default', grams: null, calories: null }),
      row({ item: 'Magazine', icon: 'default', grams: null, calories: null, photoRef: 'ph_1' }),
      row({ item: 'OIKOS PRO PLAIN', grams: null, unit: 'ml' }),
    ]);
    expect(s.rows).toBe(3);
    expect(s.noArtwork).toEqual({ count: 1, samples: ['Magazine'] });
    expect(s.unknownCalories.count).toBe(2);
    expect(s.noGrams.samples).toEqual(['Magazine', 'OIKOS PRO PLAIN']);
    expect(s.allCaps.samples).toEqual(['OIKOS PRO PLAIN']);
    expect(s.duplicates).toEqual({ count: 1, samples: ['Magazine ×2'] });
  });
  it('does not treat mixed-case brand names or short acronyms as shouting', () => {
    const s = summarizeDayQuality([row({ item: 'Galbani STRING CHEESE' }), row({ item: 'BLT' , mealTime: 'x'}), row({ item: 'PB', mealTime: 'y' })]);
    expect(s.allCaps.samples).toEqual(['BLT']);
  });
});
