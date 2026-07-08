import { groupSmall } from './groupSmall.mjs';

describe('groupSmall', () => {
  const items = [
    { id: 'a', value: 50 }, { id: 'b', value: 30 },
    { id: 'c', value: 15 }, { id: 'd', value: 4 }, { id: 'e', value: 1 }
  ];

  test('cumulativeShare keeps head until share covered, folds tail', () => {
    const { kept, other } = groupSmall(items, { cumulativeShare: 0.8 });
    expect(kept.map(i => i.id)).toEqual(['a', 'b']); // 50 then 80/100 = 0.8 → stop
    expect(other.value).toBe(20);
    expect(other.items.map(i => i.id)).toEqual(['c', 'd', 'e']);
  });

  test('minShare folds items under the threshold', () => {
    const { kept, other } = groupSmall(items, { minShare: 0.05 });
    expect(kept.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(other.value).toBe(5);
  });

  test('maxItems caps the kept list', () => {
    const { kept, other } = groupSmall(items, { minShare: 0, maxItems: 2 });
    expect(kept).toHaveLength(2);
    expect(other.value).toBe(20);
  });

  test('zero/negative total → nothing kept, no other', () => {
    expect(groupSmall([{ value: 0 }], { minShare: 0.1 })).toEqual({ kept: [], other: null });
  });
});
