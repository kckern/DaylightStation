import { describe, expect, test } from 'vitest';
import { calculateVirtualRange } from './useVirtualFeedWindow.js';

const items = Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}` }));

describe('calculateVirtualRange', () => {
  test('bounds mounted rows at the start of a long feed', () => {
    const range = calculateVirtualRange(items, () => 72, { viewportHeight: 900, maxMounted: 60, gap: 0 });
    expect(range.end - range.start).toBeLessThanOrEqual(60);
    expect(range.start).toBe(0);
    expect(range.paddingBottom).toBeGreaterThan(0);
  });

  test('preserves spacer height while windowing the middle of a long feed', () => {
    const range = calculateVirtualRange(items, () => 72, { viewportTop: 18_000, viewportHeight: 900, maxMounted: 60, gap: 0 });
    expect(range.end - range.start).toBeLessThanOrEqual(60);
    expect(range.start).toBeGreaterThan(0);
    expect(range.paddingTop).toBeGreaterThan(0);
    expect(range.paddingBottom).toBeGreaterThan(0);
  });
});
