// The browser's move and Undo against the real command and YAML ledger, for the
// dish links that groupRows shows one way and the ledger holds another.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlNutriListDatastore } from '../../server/adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from '../../server/application/health/MealFoodCommands.mjs';
import { HealthOperationsProvider, useHealthOperations } from '../operations/HealthOperationsProvider.jsx';
import { mealEntries, useMealMoves } from './mealDrag.jsx';

const date = '2026-09-06', today = '2026-09-07';
const food = (uuid, extra = {}) => ({ uuid, userId: 'u', name: uuid, date, mealTime: 'evening', grams: 10, unit: 'g', amount: 10, calories: 20, protein: 1, ...extra });
const header = extra => food('dish', { id: 'dish1', kind: 'group', calories: 0, protein: 0, ...extra });
let root, store, commands;

const send = async (route, body) => {
  if (route.endsWith('foods-move')) return commands.moveFoods('u', { ...body, today });
  if (route.endsWith('meal-undo')) return commands.undo('u', body);
  return { items: await store.findByDate('u', new URL(route, 'http://x').searchParams.get('date')) };
};
const open = async () => {
  const items = await store.findByDate('u', date);
  const wrapper = ({ children }) => <HealthOperationsProvider userId="u" send={send}>{children}</HealthOperationsProvider>;
  const view = renderHook(() => ({ moves: useMealMoves({ items, reload: () => {} }), ops: useHealthOperations() }), { wrapper });
  return { ...view, items, meal: bucket => mealEntries(items.filter(row => row.mealTime === bucket)) };
};
const saved = async uuid => (await store.findByDate('u', date)).find(row => row.uuid === uuid);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-links-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
  commands = new MealFoodCommands({ nutritionItems: store });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('moving foods with broken dish links', () => {
  it.each([['uuid', 'dish'], ['short id', 'dish1']])('a dish split across meals moves whole when its part links by %s, and Undo restores the split', async (_label, parentId) => {
    await store.saveMany([header(), food('near', { parentId: 'dish' }), food('far', { mealTime: 'morning', parentId })]);
    const { result, meal } = await open();
    const [dish] = meal('evening');
    await act(async () => { await result.current.moves.move(dish, 'night', 'evening'); });
    expect(result.current.moves.error).toBeNull();
    expect((await saved('far')).mealTime).toBe('night');
    expect((await saved('near')).mealTime).toBe('night');
    await act(async () => { await result.current.moves.undo.run(); });
    expect(result.current.moves.error).toBeNull();
    expect(await saved('far')).toMatchObject({ mealTime: 'morning', parentId });
  });
  it('a food shown loose because its dish is gone moves, and Undo restores the old link', async () => {
    await store.saveMany([food('lost', { parentId: 'gone' })]);
    const { result, meal } = await open();
    await act(async () => { await result.current.moves.move(meal('evening')[0], 'night', 'evening'); });
    expect(await saved('lost')).toMatchObject({ mealTime: 'night', parentId: null });
    await act(async () => { await result.current.moves.undo.run(); });
    expect(await saved('lost')).toMatchObject({ mealTime: 'evening', parentId: 'gone' });
  });
  it('a part shown loose in another meal moves out of its dish', async () => {
    await store.saveMany([header(), food('near', { parentId: 'dish' }), food('far', { mealTime: 'morning', parentId: 'dish1' })]);
    const { result, meal } = await open();
    await act(async () => { await result.current.moves.moveToDay(meal('morning'), '2026-09-05'); });
    expect(result.current.moves.error).toBeNull();
    expect((await store.findByDate('u', '2026-09-05')).map(row => [row.uuid, row.parentId ?? null])).toEqual([['far', null]]);
  });
  it('a stale version is refused without locking the food', async () => {
    await store.saveMany([food('a')]);
    const { result, meal } = await open();
    await store.update('u', 'a', { name: 'edited' });
    await act(async () => { await result.current.moves.move(meal('evening')[0], 'night', 'evening'); });
    expect(result.current.moves.error).toMatch(/^Couldn't move a/);
    expect(result.current.ops.store.isReserved(['a'])).toBe(false);
  });
});
