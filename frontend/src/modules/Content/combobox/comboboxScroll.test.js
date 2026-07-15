import { describe, it, expect } from 'vitest';
import { computeScrollRestore, shouldPositionLevel } from './comboboxScroll.js';

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

describe('shouldPositionLevel', () => {
  const base = { levelKey: 'b:s8', positionedLevel: null, highlightIdx: 10, itemsLength: 21 };

  it('positions the first time a browse level presents its reference with items', () => {
    expect(shouldPositionLevel(base)).toEqual({ run: true, reason: 'position' });
  });

  it('does not run when not browsing', () => {
    expect(shouldPositionLevel({ ...base, levelKey: null }).run).toBe(false);
  });

  it('does not re-run for a level already positioned (no viewport yank)', () => {
    expect(shouldPositionLevel({ ...base, positionedLevel: 'b:s8' }))
      .toEqual({ run: false, reason: 'already-positioned' });
  });

  it('waits when there is no reference row (idx -1)', () => {
    expect(shouldPositionLevel({ ...base, highlightIdx: -1 }))
      .toEqual({ run: false, reason: 'no-reference' });
  });

  it('waits until browse items have populated', () => {
    expect(shouldPositionLevel({ ...base, itemsLength: 0 }))
      .toEqual({ run: false, reason: 'no-items' });
  });
});
