import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';
import { ReviseDishService } from './ReviseDishService.mjs';

const date = '2026-10-01';
const row = (uuid, name, calories, extra = {}) => ({ uuid, userId: 'u', name, item: name, date, mealTime: 'afternoon', grams: 100, unit: 'g', amount: 100, calories, protein: 5, ...extra });
let root, store, commands, answer, service;
const ai = { chat: async () => JSON.stringify(answer) };
const byName = async () => Object.fromEntries((await store.findByDate('u', date)).map(r => [r.name, r]));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-revise-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
  commands = new MealFoodCommands({ nutritionItems: store });
  service = new ReviseDishService({ nutritionItems: store, aiGateway: ai, mealCommands: commands });
  await store.saveMany([
    row('soup', 'Curry Noodle Soup', 0, { kind: 'group', grams: 0, amount: 0 }),
    row('noodles', 'Rice Noodles', 300, { parentId: 'soup' }),
    row('chicken', 'Chicken', 145, { parentId: 'soup' }),
    row('lime', 'Lime', 2, { parentId: 'soup' }),
    row('tea', 'Iced Tea', 90),
  ]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ReviseDishService', () => {
  it('removes, changes and adds parts in one undoable change', async () => {
    answer = { keep: [{ id: 'chicken', changes: { grams: 120 } }, { id: 'lime' }], remove: ['noodles'],
      add: [{ name: 'Curry Broth', grams: 300, calories: 180 }, { name: 'Tofu', grams: 80, calories: 90 }], note: 'no noodles' };
    const result = await service.revise('u', { groupUuid: 'soup', instruction: 'no noodles; broth, chicken and tofu' });
    expect(result).toMatchObject({ removed: ['Rice Noodles'], added: ['Curry Broth', 'Tofu'], changed: ['Chicken'] });
    const after = await byName();
    expect(after['Rice Noodles']).toBeUndefined();
    expect(after.Chicken).toMatchObject({ grams: 120, parentId: 'soup' });
    expect(after.Chicken.calories).toBeCloseTo(145 * 1.2);
    expect(after.Tofu.parentId).toBe('soup');
    expect(after['Iced Tea'].parentId ?? null).toBeNull();
    await commands.undo('u', { undoToken: result.undoToken, operationId: 'undo-1' });
    const undone = await byName();
    expect(undone['Rice Noodles'].parentId).toBe('soup');
    expect(undone.Tofu).toBeUndefined();
    expect(undone.Chicken.grams).toBe(100);
  });

  it('keeps a part the model forgot to mention', async () => {
    answer = { keep: [{ id: 'chicken' }], remove: ['noodles'], add: [] };
    await service.revise('u', { groupUuid: 'soup', instruction: 'no noodles' });
    expect((await byName()).Lime.parentId).toBe('soup');
  });

  it('rejects an id that is not a part of the dish, and writes nothing', async () => {
    answer = { keep: [], remove: ['tea'], add: [] };
    await expect(service.revise('u', { groupUuid: 'soup', instruction: 'no tea' })).rejects.toMatchObject({ status: 422 });
    expect((await byName())['Iced Tea']).toBeTruthy();
  });

  it('never lets a part share the dish name', async () => {
    answer = { keep: [{ id: 'noodles', changes: { name: 'Curry Noodle Soup' } }], remove: [], add: [] };
    await service.revise('u', { groupUuid: 'soup', instruction: 'the noodles were the soup' });
    expect((await byName())['Curry Noodle Soup Base'].parentId).toBe('soup');
  });

  it('refuses a single food and a correction that changes nothing', async () => {
    answer = { keep: [{ id: 'noodles' }, { id: 'chicken' }, { id: 'lime' }], remove: [], add: [] };
    await expect(service.revise('u', { groupUuid: 'tea', instruction: 'x' })).rejects.toMatchObject({ status: 422 });
    await expect(service.revise('u', { groupUuid: 'soup', instruction: 'looks right' })).rejects.toMatchObject({ status: 422 });
  });
});
