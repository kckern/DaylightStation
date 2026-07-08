import { buildTreemapData, buildDrillData } from './drawer';

describe('buildTreemapData', () => {
  const txns = [
    { tagNames: ['Food'], description: 'Costco', expenseAmount: 80 },
    { tagNames: ['Food'], description: 'Cafe', expenseAmount: 15 },
    { tagNames: ['Food'], description: 'Refund', expenseAmount: -10 },
    { tagNames: ['Fuel'], description: 'Gas', expenseAmount: 40 }
  ];

  test('accumulates by tag using expenseAmount (refunds reduce, never negative nodes)', () => {
    const data = buildTreemapData(txns);
    const food = data.find(e => e.id === 'Food');
    expect(food.value).toBe(85); // 80 + 15 - 10
    expect(data.every(e => e.value > 0)).toBe(true);
  });

  test('fully-refunded tags are dropped', () => {
    const data = buildTreemapData([{ tagNames: ['X'], description: 'a', expenseAmount: 5 }, { tagNames: ['X'], description: 'b', expenseAmount: -9 }]);
    expect(data.find(e => e.id === 'X')).toBeUndefined();
  });
});

describe('buildDrillData', () => {
  const mk = (tag, amount) => ({ tagNames: [tag], amount });
  const txns = [
    ...Array.from({ length: 5 }, () => mk('Big', 100)),
    mk('Small1', 3), mk('Small2', 2), mk('Tiny', 0.5)
  ];

  test('folds sub-2% tags into a single entry displayed as "Other"', () => {
    const { topData } = buildDrillData(txns);
    const other = topData.find((d) => d.drilldown === 'Other');
    expect(other).toBeDefined();
    expect(other.name).toBe('Other');
  });

  test('no point anywhere carries the internal name Other2', () => {
    const { topData, drillSeries } = buildDrillData(txns);
    const allNames = [...topData.map(d => d.name), ...drillSeries.flatMap(s => s.data.map(d => d.name))];
    expect(allNames).not.toContain('Other2');
  });
});
