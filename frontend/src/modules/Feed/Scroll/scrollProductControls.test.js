import { describe, expect, test } from 'vitest';
import { applySessionBudget, buildScrollFilterSearch, getScrollSourceOptions } from './scrollProductControls.js';

describe('Scroll product controls', () => {
  test('preserves unrelated URL state while changing a shareable filter', () => {
    expect(buildScrollFilterSearch(new URLSearchParams('debug=1&filter=wire'), 'reddit')).toBe('debug=1&filter=reddit');
    expect(buildScrollFilterSearch(new URLSearchParams('debug=1&filter=wire'), '')).toBe('debug=1');
  });

  test('deduplicates source choices and keeps their reader-facing label', () => {
    expect(getScrollSourceOptions([
      { source: 'reddit', meta: { sourceName: 'Reddit' } },
      { source: 'reddit', meta: { sourceName: 'Another label' } },
      { source: 'komga', sourceInfo: { label: 'Books' } },
    ])).toEqual([['reddit', 'Reddit'], ['komga', 'Books']]);
  });

  test('enforces a configured session boundary without mutating the source list', () => {
    const input = Array.from({ length: 40 }, (_, id) => ({ id }));
    const result = applySessionBudget(input, 30);
    expect(result).toMatchObject({ reached: true });
    expect(result.items).toHaveLength(30);
    expect(input).toHaveLength(40);
  });
});
