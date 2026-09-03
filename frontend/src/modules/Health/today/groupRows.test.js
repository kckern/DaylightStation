import { describe, it, expect } from 'vitest';
import { groupRows } from './groupRows.js';

describe('groupRows', () => {
  it('returns an empty array for empty input', () => {
    expect(groupRows([])).toEqual([]);
  });

  it('leaves flat rows (no parentId anywhere) unchanged, in original order, each childless', () => {
    const rows = [
      { id: '1', uuid: 'u1', name: 'Eggs', calories: 140 },
      { id: '2', uuid: 'u2', name: 'Toast', calories: 90 },
    ];
    const out = groupRows(rows);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.row.name)).toEqual(['Eggs', 'Toast']);
    expect(out.every((e) => e.children.length === 0)).toBe(true);
    // Childless rollup reflects the row's own values.
    expect(out[0].rollup).toEqual({ calories: 140, protein: 0, carbs: 0, fat: 0 });
    expect(out[1].rollup).toEqual({ calories: 90, protein: 0, carbs: 0, fat: 0 });
  });

  it('attaches children to a parent matched by id, computes rollup and preserves order', () => {
    const rows = [
      { id: 'g1', uuid: 'ug1', kind: 'group', name: 'Smoothie', calories: 0, protein: 0, carbs: 0, fat: 0 },
      { id: 'c1', parentId: 'g1', name: 'Banana', calories: 105, protein: 1, carbs: 27, fat: 0.4 },
      { id: 'c2', parentId: 'g1', name: 'Protein powder', calories: 120, protein: 24, carbs: 3, fat: 1 },
    ];
    const out = groupRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].row.name).toBe('Smoothie');
    expect(out[0].children.map((c) => c.name)).toEqual(['Banana', 'Protein powder']);
    expect(out[0].rollup).toEqual({ calories: 225, protein: 25, carbs: 30, fat: 1.4 });
  });

  it('matches a child by the parent UUID when parentId points at uuid rather than id', () => {
    const rows = [
      { id: 'g1', uuid: 'group-uuid', kind: 'group', name: 'Dinner plate', calories: 0 },
      { id: 'c1', parentId: 'group-uuid', name: 'Noodles', calories: 220 },
    ];
    const out = groupRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].row.name).toBe('Dinner plate');
    expect(out[0].children).toHaveLength(1);
    expect(out[0].children[0].name).toBe('Noodles');
    expect(out[0].rollup.calories).toBe(220);
  });

  it('renders an orphaned child (parentId matches nothing in this day) as a top-level row, never dropping it', () => {
    const rows = [
      { id: '1', name: 'Apple', calories: 95 },
      { id: '2', parentId: 'no-such-parent', name: 'Mystery leftover', calories: 300 },
    ];
    const out = groupRows(rows);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.row.name)).toEqual(['Apple', 'Mystery leftover']);
    expect(out[1].children).toHaveLength(0);
    expect(out[1].rollup.calories).toBe(300);
  });

  it('flattens a group nested inside a group to one composite layer under the topmost group', () => {
    const rows = [
      { id: 'top', kind: 'group', name: 'Dinner', calories: 0 },
      { id: 'mid', parentId: 'top', kind: 'group', name: 'Pasta course', calories: 0 },
      { id: 'leaf1', parentId: 'mid', name: 'Noodles', calories: 200 },
      { id: 'leaf2', parentId: 'mid', name: 'Sauce', calories: 80 },
    ];
    const out = groupRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].row.name).toBe('Dinner');
    // All descendants land in one flat array (the nested group row included),
    // not nested inside a child's own `children`.
    expect(out[0].children.map((c) => c.name)).toEqual(['Pasta course', 'Noodles', 'Sauce']);
    expect(out[0].children.every((c) => !('children' in c))).toBe(true);
    // Rollup sums the flattened set; the nested group row itself carries
    // zero, so it doesn't double-count.
    expect(out[0].rollup.calories).toBe(280);
  });

  it('tolerates non-numeric or missing calories/macros, treating them as zero', () => {
    const rows = [
      { id: 'g1', kind: 'group', name: 'Bowl', calories: 0 },
      { id: 'c1', parentId: 'g1', name: 'Rice', calories: 'not-a-number', protein: undefined, carbs: null, fat: NaN },
      { id: 'c2', parentId: 'g1', name: 'Beans', calories: 150, protein: 9 },
    ];
    const out = groupRows(rows);
    expect(out[0].rollup).toEqual({ calories: 150, protein: 9, carbs: 0, fat: 0 });
  });

  it('siblings under one meal stay separate top-level groups (appetizer/main/dessert)', () => {
    const rows = [
      { id: 'a', kind: 'group', name: 'Appetizer', calories: 0 },
      { id: 'a1', parentId: 'a', name: 'Bruschetta', calories: 150 },
      { id: 'm', kind: 'group', name: 'Main', calories: 0 },
      { id: 'm1', parentId: 'm', name: 'Steak', calories: 500 },
    ];
    const out = groupRows(rows);
    expect(out.map((e) => e.row.name)).toEqual(['Appetizer', 'Main']);
    expect(out[0].rollup.calories).toBe(150);
    expect(out[1].rollup.calories).toBe(500);
  });

  // Every row that goes into groupRows() must come back out somewhere —
  // either as a top-level entry's `row`, or inside exactly one entry's
  // `children`. A parentId cycle must never make its members vanish (the
  // same policy already applied to an unresolvable/orphan parentId).
  it('a 2-row parentId cycle (A -> B -> A) renders both rows top-level, dropping neither', () => {
    const rows = [
      { id: 'A', parentId: 'B', name: 'A', calories: 100 },
      { id: 'B', parentId: 'A', name: 'B', calories: 200 },
    ];
    const out = groupRows(rows);
    expect(out.map((e) => e.row.id)).toEqual(['A', 'B']);
    expect(out.every((e) => e.children.length === 0)).toBe(true);
  });

  it('a 3-row parentId cycle (A -> B -> C -> A) renders every row top-level, dropping none', () => {
    const rows = [
      { id: 'A', parentId: 'C', name: 'A', calories: 10 },
      { id: 'B', parentId: 'A', name: 'B', calories: 20 },
      { id: 'C', parentId: 'B', name: 'C', calories: 30 },
    ];
    const out = groupRows(rows);
    expect(out.map((e) => e.row.id)).toEqual(['A', 'B', 'C']);
    expect(out.every((e) => e.children.length === 0)).toBe(true);
  });

  // The invariant that actually protects the user: no input row is ever
  // lost, and none is ever counted twice. Verified over a fixture that
  // mixes every shape this function has to handle at once — a normal
  // group, a loose (childless) item, an orphan, a 2-row cycle, and a
  // group nested inside a group.
  it('preserves every input row exactly once — no loss, no duplication — across a mixed fixture', () => {
    const rows = [
      // Ordinary group with two children.
      { id: 'g1', kind: 'group', name: 'Smoothie', calories: 0 },
      { id: 'g1-a', parentId: 'g1', name: 'Banana', calories: 105 },
      { id: 'g1-b', parentId: 'g1', name: 'Protein powder', calories: 120 },
      // Loose childless item.
      { id: 'loose', name: 'Apple', calories: 95 },
      // Orphan — parentId resolves to nothing in this set.
      { id: 'orphan', parentId: 'ghost', name: 'Mystery', calories: 300 },
      // 2-row cycle.
      { id: 'cyc-a', parentId: 'cyc-b', name: 'Cyc A', calories: 10 },
      { id: 'cyc-b', parentId: 'cyc-a', name: 'Cyc B', calories: 20 },
      // Group nested inside a group.
      { id: 'top', kind: 'group', name: 'Dinner', calories: 0 },
      { id: 'mid', parentId: 'top', kind: 'group', name: 'Pasta course', calories: 0 },
      { id: 'leaf', parentId: 'mid', name: 'Noodles', calories: 200 },
    ];

    const out = groupRows(rows);

    const returnedIds = [];
    for (const entry of out) {
      returnedIds.push(entry.row.id);
      for (const child of entry.children) returnedIds.push(child.id);
    }

    const inputIds = rows.map((r) => r.id);
    expect(returnedIds.slice().sort()).toEqual(inputIds.slice().sort());
  });
});
