import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlNutriListDatastore } from '../../adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';

const date = '2026-09-06';
const today = '2026-09-07';
const food = (uuid, extra = {}) => ({ uuid, userId: 'u', name: uuid, date, mealTime: 'evening', grams: 10, unit: 'g', amount: 10, calories: 20, protein: 1, logId: 'log-1', ...extra });
let root, store, commands;
const rows = day => store.findByDate('u', day);
const versions = async () => Object.fromEntries((await rows(date)).map(row => [row.uuid, row.version ?? 1]));
const move = async extra => commands.moveFoods('u', { operationId: 'move-1', date, today, selectedIds: ['a', 'b'], expectedVersions: await versions(), ...extra });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foods-move-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
  commands = new MealFoodCommands({ nutritionItems: store });
  await store.saveMany([food('a'), food('b', { mealTime: 'morning' }), food('c'),
    food('dish', { kind: 'group', calories: 0, protein: 0 }), food('part', { parentId: 'dish' })]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('moveFoods', () => {
  it('moves foods from different meals to another day, keeping each meal, with one Undo', async () => {
    const result = await move({ toDate: '2026-09-05' });
    expect(result).toMatchObject({ committed: true, date, movedCount: 2 });
    expect(result.affectedDates.sort()).toEqual(['2026-09-05', date]);
    expect((await rows('2026-09-05')).map(row => [row.uuid, row.mealTime]).sort()).toEqual([['a', 'evening'], ['b', 'morning']]);
    await commands.undo('u', { undoToken: result.undoToken, operationId: 'undo-1' });
    expect(await rows('2026-09-05')).toEqual([]);
    expect((await rows(date)).map(row => row.uuid)).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('changes meal and day together', async () => {
    await move({ toDate: '2026-09-05', toMeal: 'night' });
    expect((await rows('2026-09-05')).every(row => row.mealTime === 'night')).toBe(true);
  });
  it('carries a dish with its parts and refuses a part on its own', async () => {
    await move({ selectedIds: ['dish'], toMeal: 'night' });
    expect((await rows(date)).filter(row => ['dish', 'part'].includes(row.uuid)).every(row => row.mealTime === 'night')).toBe(true);
    await expect(move({ operationId: 'move-2', selectedIds: ['part'], toMeal: 'morning' })).rejects.toMatchObject({ status: 400 });
  });
  it('changes nothing when any version is stale', async () => {
    await expect(move({ expectedVersions: { a: 9, b: 1 }, toDate: '2026-09-05' })).rejects.toMatchObject({ status: 409 });
    expect(await rows('2026-09-05')).toEqual([]);
  });
  it('refuses a future day and an empty destination', async () => {
    await expect(move({ toDate: '2026-09-08' })).rejects.toMatchObject({ status: 400 });
    await expect(move({})).rejects.toMatchObject({ status: 400 });
  });
});

describe('placeCapturedFoods', () => {
  it('spreads one capture across meals, and Undo removes the whole capture', async () => {
    const result = await commands.placeCapturedFoods('u', { operationId: 'place-1', logId: 'log-1', placements: { a: 'morning', b: 'night' } });
    const placed = Object.fromEntries((await rows(date)).map(row => [row.uuid, row.mealTime]));
    expect(placed).toMatchObject({ a: 'morning', b: 'night', c: 'evening' });
    await commands.undo('u', { undoToken: result.undoToken, operationId: 'undo-2' });
    expect(await rows(date)).toEqual([]);
  });
  it('moves dish parts with their dish', async () => {
    await commands.placeCapturedFoods('u', { operationId: 'place-2', logId: 'log-1', placements: { dish: 'afternoon' } });
    expect((await rows(date)).find(row => row.uuid === 'part').mealTime).toBe('afternoon');
  });
});
