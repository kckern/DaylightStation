import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { YamlNutriListDatastore } from '../../adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';

const date = '2026-09-06';
const today = '2026-09-07';
const food = (uuid, extra = {}) => ({ uuid, userId: 'u', name: uuid, date, mealTime: 'evening', grams: 10, unit: 'g', amount: 10, calories: 20, protein: 1, logId: 'log-1', ...extra });
let root, store, commands;
const rows = day => store.findByDate('u', day);
const versions = async () => Object.fromEntries((await rows(date)).map(row => [row.uuid, row.version ?? 1]));
const dayTotal = day => yaml.load(fs.readFileSync(path.join(root, 'lifelog/nutrition/nutriday.yml'), 'utf8'))[day]?.calories ?? 0;
const orphan = () => food('orphan', { date: '2026-08-01', logId: 'log-other', parentId: 'gone' });
const seedShortLinkDish = () => store.saveMany([food('short-dish', { id: 'shortdish', kind: 'group', calories: 0, protein: 0 }), food('short-part', { parentId: 'shortdish' })]);
const seedHeaderWithBorrowedId = () => store.saveMany([food('borrower', { id: 'dish', kind: 'group', calories: 0, protein: 0 })]);
const membership = async (groupId, selectedIds) => commands.execute('u', { action: 'membership', operationId: 'member-1', date, bucket: 'evening', groupId, selectedIds, expectedVersions: await versions() });
const parentOf = async uuid => (await rows(date)).find(row => row.uuid === uuid).parentId ?? null;
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
    const before = await rows(date);
    await expect(move({ expectedVersions: { a: 9, b: 1 }, toDate: '2026-09-05' })).rejects.toMatchObject({ status: 409 });
    expect(await rows('2026-09-05')).toEqual([]);
    expect(await rows(date)).toEqual(before);
  });
  it('refuses a day move unless a valid today is supplied', async () => {
    const before = await rows(date);
    for (const missing of [undefined, null, '', 'tomorrow', '2026-02-31']) {
      await expect(move({ toDate: '2026-09-05', today: missing })).rejects.toMatchObject({ status: 400 });
    }
    expect(await rows('2026-09-05')).toEqual([]);
    expect(await rows(date)).toEqual(before);
  });
  it('does not need today for a move within the day', async () => {
    await expect(move({ toMeal: 'night', today: undefined })).resolves.toMatchObject({ committed: true });
  });
  it('refuses a future day and an empty destination', async () => {
    await expect(move({ toDate: '2026-09-08' })).rejects.toMatchObject({ status: 400 });
    await expect(move({})).rejects.toMatchObject({ status: 400 });
  });
  it('counts only the selected foods that actually change', async () => {
    const result = await move({ toMeal: 'evening' });
    expect(result.movedCount).toBe(1);
    expect(result.affectedIds).toEqual(['b']);
  });
  it('refuses a move that changes nothing, so no Undo is issued', async () => {
    const before = await rows(date);
    await expect(move({ selectedIds: ['a'], toMeal: 'evening' })).rejects.toMatchObject({ status: 400, message: 'These foods are already there' });
    await expect(move({ operationId: 'move-2', selectedIds: ['a'], toDate: date })).rejects.toMatchObject({ status: 400 });
    expect(await rows(date)).toEqual(before);
  });
  it('is not blocked by a bad dish row elsewhere in the ledger, in the move or its Undo', async () => {
    await store.saveMany([orphan()]);
    const result = await move({ toDate: '2026-09-05' });
    expect((await rows('2026-09-05')).map(row => row.uuid).sort()).toEqual(['a', 'b']);
    await commands.undo('u', { undoToken: result.undoToken, operationId: 'undo-1' });
    expect(await rows('2026-09-05')).toEqual([]);
  });
  it('carries a part linked by its dish\'s short ID, and Undo restores both', async () => {
    await seedShortLinkDish();
    const { undoToken } = await move({ selectedIds: ['short-dish'], toDate: '2026-09-05' });
    expect((await rows('2026-09-05')).map(row => row.uuid).sort()).toEqual(['short-dish', 'short-part']);
    await commands.undo('u', { undoToken, operationId: 'undo-1' });
    expect(await rows('2026-09-05')).toEqual([]);
    expect((await rows(date)).filter(row => row.uuid.startsWith('short-')).map(row => row.date)).toEqual([date, date]);
  });
  it('still fails a touched part whose dish is missing', () => {
    expect(() => commands.validateGraph([{ uuid: 'x', parentId: 'gone' }], new Set(['x']))).toThrow('Invalid group membership');
  });
  it('applies once when the same request is replayed after commit', async () => {
    const input = { operationId: 'move-1', date, today, selectedIds: ['a', 'b'], expectedVersions: await versions(), toDate: '2026-09-05' };
    const first = await commands.moveFoods('u', input);
    expect(await commands.moveFoods('u', input)).toEqual(first);
    expect((await rows('2026-09-05')).map(row => [row.uuid, row.version]).sort()).toEqual([['a', 2], ['b', 2]]);
  });
  it('refuses Undo after a moved food was edited', async () => {
    const { undoToken } = await move({ toDate: '2026-09-05' });
    await store.update('u', 'a', { name: 'edited' });
    await expect(commands.undo('u', { undoToken, operationId: 'undo-1' })).rejects.toMatchObject({ status: 409 });
    const moved = await rows('2026-09-05');
    expect(moved.map(row => row.uuid).sort()).toEqual(['a', 'b']);
    expect(moved.find(row => row.uuid === 'a').name).toBe('edited');
  });
  it('moves a dish across days and Undo brings all of it back', async () => {
    const { undoToken, movedCount } = await move({ selectedIds: ['dish'], toDate: '2026-09-05' });
    expect(movedCount).toBe(1);
    expect((await rows('2026-09-05')).map(row => row.uuid).sort()).toEqual(['dish', 'part']);
    await commands.undo('u', { undoToken, operationId: 'undo-1' });
    expect(await rows('2026-09-05')).toEqual([]);
    expect((await rows(date)).find(row => row.uuid === 'part')).toMatchObject({ parentId: 'dish', date });
  });
  it('moves an archived food and Undo returns it to its day', async () => {
    const archived = '2026-08-20';
    const file = path.join(root, 'lifelog/nutrition/archives/nutrilist/2026-08.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.dump([food('old', { date: archived, version: 1 })]));
    const { undoToken } = await commands.moveFoods('u', { operationId: 'move-old', date: archived, today, selectedIds: ['old'], expectedVersions: { old: 1 }, toDate: '2026-09-05' });
    expect(await rows(archived)).toEqual([]);
    expect((await rows('2026-09-05')).map(row => row.uuid)).toEqual(['old']);
    expect(yaml.load(fs.readFileSync(file, 'utf8'))).toEqual([]);
    await commands.undo('u', { undoToken, operationId: 'undo-old' });
    expect((await rows(archived)).map(row => row.uuid)).toEqual(['old']);
    expect(await rows('2026-09-05')).toEqual([]);
  });
  it('keeps both days\' totals right after a move and after Undo', async () => {
    const { undoToken } = await move({ toDate: '2026-09-05' });
    expect([dayTotal(date), dayTotal('2026-09-05')]).toEqual([40, 40]);
    await commands.undo('u', { undoToken, operationId: 'undo-1' });
    expect([dayTotal(date), dayTotal('2026-09-05')]).toEqual([80, 0]);
  });
});

describe('moveFoods with broken dish links', () => {
  const row = async (uuid, day = date) => (await rows(day)).find(item => item.uuid === uuid);
  const undo = (undoToken, operationId = 'undo-1') => commands.undo('u', { undoToken, operationId });

  it('moves a food whose dish is gone, clears the link, and Undo restores it exactly', async () => {
    await store.saveMany([food('lost', { parentId: 'gone' })]);
    const { undoToken } = await move({ selectedIds: ['lost'], toMeal: 'night' });
    expect(await row('lost')).toMatchObject({ mealTime: 'night', parentId: null });
    await undo(undoToken);
    expect(await row('lost')).toMatchObject({ mealTime: 'evening', parentId: 'gone' });
  });
  it('moves a food linked to a dish in another meal as a loose food', async () => {
    await store.saveMany([food('split', { mealTime: 'morning', parentId: 'dish' })]);
    const { undoToken } = await move({ selectedIds: ['split'], toDate: '2026-09-05' });
    expect(await row('split', '2026-09-05')).toMatchObject({ mealTime: 'morning', parentId: null });
    expect(await row('dish')).toMatchObject({ mealTime: 'evening' });
    await undo(undoToken);
    expect(await row('split')).toMatchObject({ mealTime: 'morning', parentId: 'dish', date });
  });
  it('treats a link to a row that is not a dish as broken', async () => {
    await store.saveMany([food('hanger', { parentId: 'c' })]);
    await move({ selectedIds: ['hanger'], toMeal: 'night' });
    expect(await row('hanger')).toMatchObject({ mealTime: 'night', parentId: null });
  });
  it('still refuses a real part alone, and a dish selected with its part', async () => {
    await expect(move({ selectedIds: ['part'], toMeal: 'night' })).rejects.toMatchObject({ status: 400 });
    await expect(move({ operationId: 'move-2', selectedIds: ['dish', 'part'], toMeal: 'night' })).rejects.toMatchObject({ status: 400 });
  });
  it.each([['its uuid', 'dish'], ['its short id', 'dish-short']])('a dish brings back a part in another meal linked by %s, and Undo splits it again', async (_label, parentId) => {
    await store.update('u', 'dish', { id: 'dish-short' });
    await store.saveMany([food('split', { mealTime: 'morning', parentId })]);
    const { undoToken, movedCount } = await move({ selectedIds: ['dish'], toMeal: 'night' });
    expect(movedCount).toBe(1);
    expect(await row('split')).toMatchObject({ mealTime: 'night', parentId });
    expect(await row('part')).toMatchObject({ mealTime: 'night', parentId: 'dish' });
    await undo(undoToken);
    expect(await row('split')).toMatchObject({ mealTime: 'morning', parentId });
    expect(await row('dish')).toMatchObject({ mealTime: 'evening' });
  });
  it('a day move makes a split dish whole in the dish\'s meal', async () => {
    await store.saveMany([food('split', { mealTime: 'morning', parentId: 'dish' })]);
    const { undoToken } = await move({ selectedIds: ['dish'], toDate: '2026-09-05' });
    expect(await row('split', '2026-09-05')).toMatchObject({ mealTime: 'evening', parentId: 'dish' });
    await undo(undoToken);
    expect(await row('split')).toMatchObject({ mealTime: 'morning', parentId: 'dish', date });
  });
  it('keeps the link when a split part is selected together with its dish', async () => {
    await store.saveMany([food('split', { mealTime: 'morning', parentId: 'dish' })]);
    await move({ selectedIds: ['dish', 'split'], toMeal: 'night' });
    expect(await row('split')).toMatchObject({ mealTime: 'night', parentId: 'dish' });
  });
  it('a dish already in the meal still moves when that reunites a split part', async () => {
    await store.saveMany([food('split', { mealTime: 'morning', parentId: 'dish' })]);
    await expect(move({ selectedIds: ['dish'], toMeal: 'evening' })).resolves.toMatchObject({ movedCount: 1 });
    expect(await row('split')).toMatchObject({ mealTime: 'evening', parentId: 'dish' });
  });
  it('requires the version of every row a dish carries', async () => {
    await store.saveMany([food('split', { mealTime: 'morning', parentId: 'dish' })]);
    const { split, ...others } = await versions();
    await expect(move({ selectedIds: ['dish'], toMeal: 'night', expectedVersions: others })).rejects.toMatchObject({ status: 409 });
  });
  it('moves a dish with a part already stranded on another day, and Undo restores everything', async () => {
    const previous = '2026-09-05';
    await store.saveMany([food('other', { date: previous, parentId: 'dish' })]);
    const stranded = await row('other', previous);
    const { undoToken } = await move({ selectedIds: ['dish', 'a', 'c'], toMeal: 'night' });
    expect((await rows(date)).filter(item => ['dish', 'part', 'a', 'c'].includes(item.uuid)).every(item => item.mealTime === 'night')).toBe(true);
    expect(await row('other', previous)).toEqual(stranded);
    await undo(undoToken);
    expect((await rows(date)).filter(item => ['dish', 'part', 'a', 'c'].includes(item.uuid)).every(item => item.mealTime === 'evening')).toBe(true);
    expect(await row('part')).toMatchObject({ parentId: 'dish' });
    expect(await row('other', previous)).toEqual(stranded);
  });
  it('a stranded part does not excuse new breakage at Undo', async () => {
    await store.saveMany([food('other', { date: '2026-09-05', parentId: 'dish' })]);
    const { undoToken } = await move({ selectedIds: ['dish'], toMeal: 'night' });
    await store.saveMany([food('late', { mealTime: 'night', parentId: 'dish' })]);
    await expect(undo(undoToken)).rejects.toMatchObject({ status: 409 });
  });
  it('a food carries a row linked to it in its own meal and frees the link', async () => {
    await store.saveMany([food('hanger', { parentId: 'c' })]);
    await move({ selectedIds: ['c'], toMeal: 'night' });
    expect(await row('hanger')).toMatchObject({ mealTime: 'night', parentId: null });
  });
  it('a food leaves behind a row in another meal that links to it, and Undo still works', async () => {
    await store.saveMany([food('hanger', { mealTime: 'morning', parentId: 'c' })]);
    const { undoToken, affectedIds } = await move({ selectedIds: ['c'], toMeal: 'night' });
    expect(affectedIds).toEqual(['c']);
    expect(await row('hanger')).toMatchObject({ mealTime: 'morning', parentId: 'c' });
    await undo(undoToken);
    expect(await row('c')).toMatchObject({ mealTime: 'evening' });
    expect(await row('hanger')).toMatchObject({ mealTime: 'morning', parentId: 'c' });
  });
  it('Undo allows a link that was already broken but refuses new breakage', async () => {
    await store.saveMany([food('lost', { parentId: 'gone' })]);
    const { undoToken } = await move({ selectedIds: ['dish', 'lost'], toMeal: 'night' });
    await store.saveMany([food('late', { mealTime: 'night', parentId: 'dish' })]);
    await expect(undo(undoToken)).rejects.toMatchObject({ status: 409 });
    expect(await row('dish')).toMatchObject({ mealTime: 'night' });
  });
});

describe('dish membership', () => {
  it('removes an omitted part that is linked by its dish\'s short ID', async () => {
    await seedShortLinkDish();
    await membership('short-dish', ['a']);
    expect(await parentOf('short-part')).toBeNull();
    expect(await parentOf('a')).toBe('short-dish');
  });
  it('leaves another dish\'s part alone when a header\'s id equals that dish\'s uuid', async () => {
    await seedHeaderWithBorrowedId();
    await membership('borrower', ['a']);
    expect(await parentOf('part')).toBe('dish');
    expect(await parentOf('a')).toBe('borrower');
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
  it('moves a part linked by its dish\'s short ID with the dish', async () => {
    await seedShortLinkDish();
    await commands.placeCapturedFoods('u', { operationId: 'place-7', logId: 'log-1', placements: { 'short-dish': 'afternoon' } });
    expect((await rows(date)).filter(row => row.uuid.startsWith('short-')).map(row => row.mealTime)).toEqual(['afternoon', 'afternoon']);
  });
  it('keeps a part with the dish whose uuid it names when another header has that id', async () => {
    await seedHeaderWithBorrowedId();
    await commands.placeCapturedFoods('u', { operationId: 'place-10', logId: 'log-1', placements: { dish: 'night' } });
    const placed = Object.fromEntries((await rows(date)).map(row => [row.uuid, row.mealTime]));
    expect(placed).toMatchObject({ dish: 'night', part: 'night', borrower: 'evening' });
  });
  it('refuses a placement keyed by a part linked through a short ID', async () => {
    await seedShortLinkDish();
    await expect(commands.placeCapturedFoods('u', { operationId: 'place-8', logId: 'log-1', placements: { 'short-part': 'morning' } })).rejects.toMatchObject({ status: 400 });
  });
  it.each([['its ID', 'dish'], ['its short ID', 'shortdish']])('refuses an Undo that would delete a dish linked by %s from a part outside the capture', async (_label, parentId) => {
    await seedShortLinkDish();
    await store.saveMany([food('stray', { logId: 'log-other', parentId })]);
    const { undoToken } = await commands.placeCapturedFoods('u', { operationId: 'place-9', logId: 'log-1', placements: { a: 'morning' } });
    await expect(commands.undo('u', { undoToken, operationId: 'undo-9' })).rejects.toMatchObject({ status: 409 });
    expect((await rows(date)).some(row => row.uuid === 'a')).toBe(true);
  });
  it('refuses a capture that changed after it was logged', async () => {
    await store.update('u', 'a', { name: 'edited' });
    const before = await rows(date);
    await expect(commands.placeCapturedFoods('u', { operationId: 'place-3', logId: 'log-1', placements: { b: 'night' } })).rejects.toMatchObject({ status: 409 });
    expect(await rows(date)).toEqual(before);
  });
  it('is not blocked by a bad dish row elsewhere in the ledger, in the placement or its Undo', async () => {
    await store.saveMany([orphan()]);
    const { undoToken } = await commands.placeCapturedFoods('u', { operationId: 'place-4', logId: 'log-1', placements: { a: 'morning' } });
    expect((await rows(date)).find(row => row.uuid === 'a').mealTime).toBe('morning');
    await commands.undo('u', { undoToken, operationId: 'undo-4' });
    expect(await rows(date)).toEqual([]);
  });
  it.each([[null], [['a']], ['morning'], [{ a: 'brunch' }]])('refuses malformed placements %j before using the operation ID', async placements => {
    await expect(commands.placeCapturedFoods('u', { operationId: 'place-5', logId: 'log-1', placements })).rejects.toMatchObject({ status: 400 });
    await expect(commands.placeCapturedFoods('u', { operationId: 'place-5', logId: 'log-1', placements: { a: 'morning' } })).resolves.toMatchObject({ committed: true });
  });
  it.each([['an unknown food', 'nope'], ['a dish part', 'part']])('refuses a placement for %s', async (_label, id) => {
    const before = await rows(date);
    await expect(commands.placeCapturedFoods('u', { operationId: 'place-6', logId: 'log-1', placements: { [id]: 'morning' } })).rejects.toMatchObject({ status: 400 });
    expect(await rows(date)).toEqual(before);
  });
});
