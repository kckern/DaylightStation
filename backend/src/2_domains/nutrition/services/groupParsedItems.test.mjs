import { describe, it, expect } from 'vitest';
import { groupParsedItems } from './groupParsedItems.mjs';
import { validateFoodItem } from '../entities/schemas.mjs';

function makeIdSequence(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function baseItem(overrides = {}) {
  return {
    id: 'item-uuid',
    label: 'Apple',
    icon: 'apple',
    grams: 150,
    unit: 'g',
    amount: 150,
    color: 'green',
    calories: 80,
    protein: 0,
    carbs: 20,
    fat: 0,
    fiber: 3,
    sugar: 15,
    sodium: 0,
    cholesterol: 0,
    ...overrides,
  };
}

describe('groupParsedItems — no dish anywhere (backward-compat pin)', () => {
  it('returns the input plus kind:"item", same length, same order, nothing else altered', () => {
    const input = [
      baseItem({ id: 'a', label: 'Apple', settled: false }),
      baseItem({ id: 'b', label: 'Toast', color: 'yellow' }),
    ];
    const makeId = makeIdSequence();

    const out = groupParsedItems(input, { makeId });

    expect(out).toHaveLength(input.length);
    expect(out.map((i) => i.label)).toEqual(['Apple', 'Toast']);
    out.forEach((item, idx) => {
      expect(item.kind).toBe('item');
      // Everything else from the input item is preserved verbatim.
      const { ...expected } = input[idx];
      expect(item).toEqual({ ...expected, kind: 'item' });
    });
    // makeId was never invoked — no dish means no group synthesis.
    expect(out.every((i) => !('parentId' in i))).toBe(true);
  });
});

describe('groupParsedItems — one dish, three members', () => {
  it('emits 4 entries: group first, each member carries the group id as parentId', () => {
    const input = [
      baseItem({ id: 'm1', label: 'Banana', dish: 'Smoothie', grams: 120, color: 'green', icon: 'banana' }),
      baseItem({ id: 'm2', label: 'Milk', dish: 'Smoothie', grams: 200, color: 'yellow' }),
      baseItem({ id: 'm3', label: 'Protein Powder', dish: 'Smoothie', grams: 30, color: 'green' }),
    ];
    const makeId = makeIdSequence('grp');

    const out = groupParsedItems(input, { makeId });

    expect(out).toHaveLength(4);
    const [group, ...members] = out;

    expect(group.kind).toBe('group');
    expect(group.label).toBe('Smoothie');
    expect(group.id).toBe('grp-1');
    expect(group.icon).toBe('default'); // A dish is not its first ingredient.
    expect(group.grams).toBe(120 + 200 + 30);
    expect(group.amount).toBe(group.grams);
    expect(group.unit).toBe('g');
    expect(group.color).toBe('green'); // 2 green vs 1 yellow

    expect(members).toHaveLength(3);
    for (const member of members) {
      expect(member.kind).toBe('item');
      expect(member.parentId).toBe(group.id);
      expect('dish' in member).toBe(false);
    }
  });
});

describe('groupParsedItems — two distinct dishes plus a loose item', () => {
  it('produces two sibling groups with correct membership and an ungrouped loose item', () => {
    const input = [
      baseItem({ id: 'p1a', label: 'Chicken Breast', dish: 'Plate 1', grams: 150, color: 'yellow' }),
      baseItem({ id: 'loose', label: 'Sparkling Water', grams: 350, color: 'green' }),
      baseItem({ id: 'p1b', label: 'Rice', dish: 'Plate 1', grams: 180, color: 'yellow' }),
      baseItem({ id: 'p2a', label: 'Salad', dish: 'Plate 2', grams: 100, color: 'green' }),
    ];
    const makeId = makeIdSequence('grp');

    const out = groupParsedItems(input, { makeId });

    // group(Plate 1) + 2 members + loose item + group(Plate 2) + 1 member = 6
    expect(out).toHaveLength(6);

    const plate1Group = out.find((i) => i.kind === 'group' && i.label === 'Plate 1');
    const plate2Group = out.find((i) => i.kind === 'group' && i.label === 'Plate 2');
    expect(plate1Group).toBeTruthy();
    expect(plate2Group).toBeTruthy();
    expect(plate1Group.id).not.toBe(plate2Group.id);

    const plate1Members = out.filter((i) => i.kind === 'item' && i.parentId === plate1Group.id);
    const plate2Members = out.filter((i) => i.kind === 'item' && i.parentId === plate2Group.id);
    expect(plate1Members.map((m) => m.label).sort()).toEqual(['Chicken Breast', 'Rice']);
    expect(plate2Members.map((m) => m.label)).toEqual(['Salad']);

    const looseOut = out.find((i) => i.label === 'Sparkling Water');
    expect(looseOut.kind).toBe('item');
    expect('parentId' in looseOut).toBe(false);
  });
});

describe('groupParsedItems — synthesized group passes validateFoodItem', () => {
  it('the group entry is a valid FoodItem', () => {
    const input = [
      baseItem({ id: 'm1', label: 'Noodles', dish: 'Spaghetti', grams: 200, color: 'yellow' }),
      baseItem({ id: 'm2', label: 'Sauce', dish: 'Spaghetti', grams: 100, color: 'green' }),
    ];
    // Use a real UUID-shaped id factory so validateFoodItem's id check passes.
    const uuidLike = () => '5b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
    const out = groupParsedItems(input, { makeId: uuidLike });

    const group = out.find((i) => i.kind === 'group');
    expect(group).toBeTruthy();

    const result = validateFoodItem(group);
    expect(result.valid).toBe(true);
  });
});

describe('groupParsedItems — group nutrition is always zero', () => {
  it('never sums member calories/macros onto the group', () => {
    const input = [
      baseItem({ id: 'm1', label: 'Bun', dish: 'Burger', grams: 60, calories: 150, protein: 4, carbs: 30, fat: 2, fiber: 1, sugar: 2, sodium: 200, cholesterol: 0 }),
      baseItem({ id: 'm2', label: 'Patty', dish: 'Burger', grams: 120, calories: 300, protein: 25, carbs: 0, fat: 20, fiber: 0, sugar: 0, sodium: 400, cholesterol: 80 }),
    ];
    const makeId = makeIdSequence();

    const out = groupParsedItems(input, { makeId });
    const group = out.find((i) => i.kind === 'group');

    expect(group.calories).toBe(0);
    expect(group.protein).toBe(0);
    expect(group.carbs).toBe(0);
    expect(group.fat).toBe(0);
    expect(group.fiber).toBe(0);
    expect(group.sugar).toBe(0);
    expect(group.sodium).toBe(0);
    expect(group.cholesterol).toBe(0);
  });
});

describe('groupParsedItems — settled survives the mapper', () => {
  it('settled:false on an input item is preserved through the mapper (standalone item)', () => {
    const input = [baseItem({ id: 'x', label: 'Toast', settled: false })];
    const out = groupParsedItems(input, { makeId: makeIdSequence() });
    expect(out[0].settled).toBe(false);
  });

  it('settled:false on a dish member is preserved through the mapper', () => {
    const input = [
      baseItem({ id: 'm1', label: 'Yogurt', dish: 'Parfait', settled: false }),
      baseItem({ id: 'm2', label: 'Granola', dish: 'Parfait', settled: false }),
    ];
    const out = groupParsedItems(input, { makeId: makeIdSequence() });
    const members = out.filter((i) => i.kind === 'item');
    expect(members.every((m) => m.settled === false)).toBe(true);
    // The synthesized group itself carries no settled field — it's not a captured row.
    const group = out.find((i) => i.kind === 'group');
    expect('settled' in group).toBe(false);
  });
});

describe('groupParsedItems — makeId contract', () => {
  it('throws if makeId is not a function', () => {
    expect(() => groupParsedItems([baseItem()], {})).toThrow();
  });

  it('returns an empty array for empty input', () => {
    expect(groupParsedItems([], { makeId: makeIdSequence() })).toEqual([]);
  });
});
