import { describe, it, expect } from 'vitest';
import { selectItemsForPrint } from '#domains/gratitude/services/PrintSelectionService.mjs';

describe('selectItemsForPrint', () => {
  const makeItem = (id, daysOld = 1, printCount = 0) => ({
    id,
    datetime: new Date(Date.now() - daysOld * 86400000).toISOString(),
    printCount,
    item: { text: `Item ${id}` },
  });

  it('returns all items if count >= items.length', () => {
    const items = [makeItem('a'), makeItem('b')];
    const result = selectItemsForPrint(items, 5);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(selectItemsForPrint([], 3)).toEqual([]);
    expect(selectItemsForPrint(null, 3)).toEqual([]);
  });

  it('returns requested count', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`item-${i}`, i + 1));
    const result = selectItemsForPrint(items, 3);
    expect(result).toHaveLength(3);
  });

  it('prioritizes items with lower printCount', () => {
    const items = [
      makeItem('printed-5x', 1, 5),
      makeItem('printed-0x', 1, 0),
      makeItem('printed-3x', 1, 3),
    ];
    const counts = { 'printed-5x': 0, 'printed-0x': 0, 'printed-3x': 0 };
    for (let i = 0; i < 100; i++) {
      const result = selectItemsForPrint(items, 1);
      counts[result[0].id]++;
    }
    expect(counts['printed-0x']).toBeGreaterThan(counts['printed-5x']);
  });

  it('returns items with correct structure', () => {
    const items = [makeItem('a')];
    const result = selectItemsForPrint(items, 1);
    expect(result[0]).toHaveProperty('id', 'a');
    expect(result[0]).toHaveProperty('datetime');
    expect(result[0]).toHaveProperty('printCount');
  });
});
