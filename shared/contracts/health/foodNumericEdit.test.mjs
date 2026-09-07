import { describe, it, expect } from 'vitest';
import { numericFoodPatches } from './foodNumericEdit.mjs';

const a = { uuid: 'a', grams: 100, calories: 200, protein: 20, carbs: 15, fat: 5, fiber: null };
const b = { uuid: 'b', grams: 200, calories: 100, protein: 10, carbs: 5, fat: 2 };
const group = { uuid: 'g', kind: 'group', calories: 0, children: [a, b] };
const patch = (row, field, value) => numericFoodPatches(row, { field, value });

describe('numeric food relationships', () => {
  it('scales servings from calories and preserves unknowns and density', () => {
    expect(patch(a, 'calories', 400).get('a')).toMatchObject({ grams: 200, calories: 400, protein: 40 });
    expect(patch(a, 'calories', 400).get('a')).not.toHaveProperty('fiber');
  });
  it('changes density at fixed mass', () => {
    const changes = patch(a, 'density', 3).get('a');
    expect(changes).toMatchObject({ calories: 300, protein: 30, carbs: 22.5, fat: 7.5 });
    expect(changes).not.toHaveProperty('grams');
  });
  it('preserves the existing calorie discrepancy when correcting a macro', () => {
    expect(patch(a, 'protein', 25).get('a')).toEqual({ protein: 25, calories: 220 });
    expect(patch(a, 'fat', 0).get('a')).toEqual({ fat: 0, calories: 155 });
  });
  it('distributes group protein corrections proportionally without additive parent totals', () => {
    const changes = patch(group, 'protein', 45);
    expect(changes.get('a')).toEqual({ protein: 30, calories: 240 });
    expect(changes.get('b')).toEqual({ protein: 15, calories: 120 });
    expect(changes.get('g')).toEqual({});
  });
  it('scales group calories and density across every ingredient', () => {
    expect(patch(group, 'calories', 600).get('a')).toMatchObject({ grams: 200, calories: 400 });
    expect(patch(group, 'density', 2).get('b')).toMatchObject({ calories: 200, protein: 20 });
    expect(patch(group, 'density', 2).get('b')).not.toHaveProperty('grams');
  });
  it('allocates a known-zero macro using mass', () => {
    const changes = patch({ ...group, children: [{ ...a, protein: 0 }, { ...b, protein: 0 }] }, 'protein', 30);
    expect(changes.get('a')).toEqual({ protein: 10, calories: 240 });
    expect(changes.get('b')).toEqual({ protein: 20, calories: 180 });
  });
  it('rounds tiny group targets without negative remainder and permits individual zero macros without known mass', () => {
    const children = Array.from({ length: 8 }, (_, index) => ({ ...a, uuid: String(index) }));
    const result = patch({ ...group, children }, 'protein', 0.04);
    const total = children.reduce((sum, child) => sum + result.get(child.uuid).protein, 0);
    expect(total).toBeCloseTo(0.04);
    for (const child of children) expect(result.get(child.uuid).protein).toBeGreaterThanOrEqual(0);
    expect(patch({ ...a, grams: null, protein: 0 }, 'protein', 5).get('a')).toEqual({ protein: 5, calories: 220 });
  });
  it('rejects missing allocation data, negative results, and nonfinite values', () => {
    expect(() => patch({ ...group, children: [a, { ...b, protein: null }] }, 'protein', 40)).toThrow(/protein.*b/i);
    expect(() => patch({ ...a, calories: 10 }, 'protein', 0)).toThrow(/negative/i);
    expect(() => patch(a, 'density', Infinity)).toThrow();
    expect(() => patch(a, 'calories', 0)).toThrow();
  });
});
