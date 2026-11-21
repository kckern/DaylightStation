import { describe, it, expect } from 'vitest';
import { shouldRunScrollToHighlighted, shouldPositionLevel } from "./comboboxScroll.js";

describe('shouldRunScrollToHighlighted', () => {
  it('leaves scroll to the anchor when pagination shifts the same highlighted row', () => {
    expect(shouldRunScrollToHighlighted({ highlightedIdx: 31, prevIdx: 10, hasSameHighlight: true }).run).toBe(false);
  });

  it('reveals a different highlighted row during keyboard navigation', () => {
    expect(shouldRunScrollToHighlighted({ highlightedIdx: 11, prevIdx: 10, hasSameHighlight: false }).run).toBe(true);
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
