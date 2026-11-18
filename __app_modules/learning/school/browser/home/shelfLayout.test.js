import { describe, it, expect } from 'vitest';
import { planBands, LIST_CAP } from './shelfLayout.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

describe('planBands fill', () => {
  it('lets a band of only list shelves take the full width', () => {
    const [band] = planBands([{ kindId: 'decks', items: items(9) }]);
    expect(band.shelves[0]).toMatchObject({ fill: true, wide: false, cap: LIST_CAP });
  });
  it('keeps a list shelf narrow beside posters', () => {
    const [band] = planBands([{ kindId: 'video', items: items(2) }, { kindId: 'apps', items: items(2) }]);
    expect(band.shelves.map((s) => s.fill)).toEqual([false, false]);
  });
  it('fills the list shelves that follow a full-width poster band', () => {
    const bands = planBands([{ kindId: 'video', items: items(8) }, { kindId: 'decks', items: items(5) }]);
    expect(bands[0].shelves[0]).toMatchObject({ wide: true, fill: false });
    expect(bands[1].shelves[0].fill).toBe(true);
  });
});
