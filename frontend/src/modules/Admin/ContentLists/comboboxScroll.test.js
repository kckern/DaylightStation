import { describe, it, expect } from 'vitest';
import { computeScrollRestore } from './comboboxScroll.js';

describe('computeScrollRestore', () => {
  it('offsets scrollTop by the height the prepended items added', () => {
    expect(
      computeScrollRestore({ prevScrollHeight: 300, newScrollHeight: 500, prevScrollTop: 40 }),
    ).toBe(240);
  });

  it('is a no-op when the viewport height did not grow', () => {
    expect(
      computeScrollRestore({ prevScrollHeight: 500, newScrollHeight: 500, prevScrollTop: 40 }),
    ).toBe(40);
  });
});
