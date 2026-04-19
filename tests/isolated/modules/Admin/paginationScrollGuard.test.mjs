import { describe, it, expect } from 'vitest';
import { shouldRunScrollToHighlighted } from '#frontend/modules/Admin/ContentLists/comboboxScroll.js';

describe('shouldRunScrollToHighlighted', () => {
  it('returns false when highlightedIdx is negative', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: -1, prevIdx: 5, paginationInFlight: false
    })).toEqual({ run: false, reason: 'no-highlight' });
  });

  it('returns false on initial render (prevIdx === -1)', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: -1, paginationInFlight: false
    })).toEqual({ run: false, reason: 'initial-render' });
  });

  it('returns false when pagination is in flight (append)', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: 3, paginationInFlight: true
    })).toEqual({ run: false, reason: 'pagination' });
  });

  it('returns true when highlightedIdx actually changed', () => {
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 4, prevIdx: 3, paginationInFlight: false
    })).toEqual({ run: true, reason: 'navigation' });
  });

  it('returns false when highlightedIdx did not change and no pagination', () => {
    // This covers benign re-runs from unrelated state changes.
    expect(shouldRunScrollToHighlighted({
      highlightedIdx: 3, prevIdx: 3, paginationInFlight: false
    })).toEqual({ run: false, reason: 'no-change' });
  });
});
