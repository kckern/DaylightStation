import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';
import { YamlNutriListDatastore } from '../../adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { DayInstructionService } from './DayInstructionService.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';
import { HealthOperations } from './HealthOperations.mjs';

const date = '2026-11-18', today = date;
const rows = [
  { uuid: 'eggs', name: 'Eggs', date, mealTime: 'morning', logId: 'old', createdAt: '2026-11-18T08:00:00Z', version: 1 },
  { uuid: 'tea', name: 'Iced tea', date, mealTime: 'afternoon', logId: 'new', createdAt: '2026-11-18T12:00:00Z', version: 2 },
  { uuid: 'milk', name: 'Milk', grams: 200, amount: 200, unit: 'g', date, mealTime: 'afternoon', logId: 'new', createdAt: '2026-11-18T12:00:00Z', version: 1 },
];
// Parts name their dish by its short ID, one of the two links the ledger allows.
const dishRows = [
  { uuid: 'dish-uuid', id: 'dish', kind: 'group', name: 'Burrito', date, mealTime: 'afternoon', logId: 'd', createdAt: '2026-11-18T12:00:00Z', version: 3 },
  { uuid: 'rice', name: 'Rice', parentId: 'dish', date, mealTime: 'afternoon', logId: 'd', createdAt: '2026-11-18T12:00:00Z', version: 4 },
  { uuid: 'beans', name: 'Beans', parentId: 'dish-uuid', date, mealTime: 'afternoon', logId: 'd', createdAt: '2026-11-18T12:00:00Z', version: 5 },
  { uuid: 'old-part', name: 'Cheese', parentId: 'dish', status: 'rejected', date, mealTime: 'afternoon', logId: 'd', createdAt: '2026-11-18T12:00:00Z', version: 6 },
];
const plan = extra => ({ intent: 'move', target: 'latest', fromMeal: 'morning', toMeal: 'same', toDay: 'same', compound: false, ...extra });
function harness(reading, { matched = [], placements = {}, dayRows = rows, stored = null } = {}) {
  const mealCommands = {
    moveFoods: vi.fn(async () => ({ committed: true, undoToken: 'meal-m', affectedDates: [date, '2026-11-17'], affectedIds: ['tea', 'milk'], items: [] })),
    placeCapturedFoods: vi.fn(async () => ({ committed: true, undoToken: 'meal-p', date, affectedDates: [date], affectedIds: ['eggs'], items: [] })),
    execute: vi.fn(async () => ({ committed: true, undoToken: 'meal-a', affectedDates: [date], affectedIds: ['milk'], items: [] })),
  };
  const entryRevisions = { propose: vi.fn(async () => ({ proposal: { name: 'Whole Milk', icon: 'milk', color: 'yellow', grams: 240, amount: 240, unit: 'g', calories: 149 } })) };
  const nutritionItems = { findByDate: vi.fn(async () => dayRows), findByLogId: vi.fn(async () => dayRows) };
  if (stored) nutritionItems.readOperationResult = vi.fn((_user, id) => stored[id] || null);
  const reader = { available: true, read: vi.fn(async () => reading), matchFoods: vi.fn(async () => matched), assignMeals: vi.fn(async () => placements) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const service = new DayInstructionService({ nutritionItems, reader, mealCommands, entryRevisions, logger });
  const captureFoods = vi.fn(async () => ({ committed: true, logId: 'new', mealTime: 'afternoon' }));
  const run = (text, extra) => service.execute('u', { text, date, today, operationId: 'op', captureFoods, ...extra });
  return { run, mealCommands, entryRevisions, reader, captureFoods, logger, nutritionItems };
}
const expectNoWrites = h => {
  expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
  expect(h.mealCommands.execute).not.toHaveBeenCalled();
  expect(h.mealCommands.placeCapturedFoods).not.toHaveBeenCalled();
  expect(h.captureFoods).not.toHaveBeenCalled();
};

describe('DayInstructionService', () => {
  it('"move that to yesterday" moves the latest capture', async () => {
    const h = harness(plan({ toDay: '2026-11-17' }));
    const result = await h.run('move that to yesterday');
    expect(h.mealCommands.moveFoods.mock.calls[0][1]).toMatchObject({ date, selectedIds: ['tea', 'milk'], toDate: '2026-11-17', toMeal: null, expectedVersions: { tea: 2, milk: 1 } });
    expect(result).toMatchObject({ committed: true, outcome: 'committed', kind: 'moved', undoToken: 'meal-m', message: 'Moved 2 foods to Yesterday', instructionText: 'move that to yesterday' });
  });
  it('"move the drinks to snacks" matches foods first', async () => {
    const h = harness(plan({ target: 'named', toMeal: 'night' }), { matched: ['tea'] });
    const result = await h.run('move the drinks to snacks');
    expect(h.mealCommands.moveFoods.mock.calls[0][1]).toMatchObject({ selectedIds: ['tea'], toMeal: 'night', toDate: null });
    expect(result.message).toBe('Moved Iced tea to Snacks');
  });
  it('moves the whole day or one meal without matching', async () => {
    const day = harness(plan({ target: 'whole_day', toDay: '2026-11-17' }));
    await day.run('all of this was yesterday');
    expect(day.mealCommands.moveFoods.mock.calls[0][1].selectedIds).toEqual(['eggs', 'tea', 'milk']);
    const meal = harness(plan({ target: 'meal', fromMeal: 'afternoon', toMeal: 'evening' }));
    await meal.run('lunch was dinner');
    expect(meal.mealCommands.moveFoods.mock.calls[0][1].selectedIds).toEqual(['tea', 'milk']);
  });
  it('asks for the day when it is older than the list, then uses the answer', async () => {
    const h = harness(plan({ toDay: 'older' }));
    expect(await h.run('that was two weeks ago')).toMatchObject({ committed: false, outcome: 'clarification', clarification: { kind: 'day' } });
    expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
    await h.run('that was two weeks ago', { resolved: { toDate: '2026-11-04' } });
    expect(h.mealCommands.moveFoods.mock.calls[0][1].toDate).toBe('2026-11-04');
  });
  it('asks which food when nothing matches', async () => {
    const h = harness(plan({ target: 'named', toMeal: 'night' }));
    const result = await h.run('move the soup to snacks');
    expect(result.clarification).toMatchObject({ kind: 'food', choices: [{ id: 'eggs', label: 'Eggs' }, { id: 'tea', label: 'Iced tea' }, { id: 'milk', label: 'Milk' }] });
    await h.run('move the soup to snacks', { resolved: { foodId: 'tea' } });
    expect(h.mealCommands.moveFoods.mock.calls[0][1].selectedIds).toEqual(['tea']);
  });
  it('refuses a food ID that is not on this day', async () => {
    const h = harness(plan({ target: 'named', toMeal: 'night' }));
    await expect(h.run('x', { resolved: { foodId: 'other' } })).rejects.toMatchObject({ status: 422 });
  });
  it('"that was actually whole milk" revises the one matching food through amend', async () => {
    const h = harness(plan({ intent: 'change' }), { matched: ['milk'] });
    const result = await h.run('that was actually whole milk');
    expect(h.entryRevisions.propose).toHaveBeenCalledWith('u', { entryUuid: 'milk', instruction: 'that was actually whole milk' });
    const command = h.mealCommands.execute.mock.calls[0][1];
    expect(command).toMatchObject({ action: 'amend', date, bucket: 'afternoon', selectedIds: ['milk'] });
    expect(command.changes.milk).toEqual({ name: 'Whole Milk', color: 'yellow', grams: 240, amount: 240, unit: 'g', calories: 149 });
    expect(result).toMatchObject({ kind: 'changed', message: 'Changed Milk to Whole Milk', undoToken: 'meal-a' });
  });
  it('a dump is captured, then placed across meals', async () => {
    const h = harness(plan({ intent: 'add' }), { placements: { eggs: 'morning', tea: 'night' } });
    const result = await h.run('eggs at breakfast and tea later');
    expect(h.captureFoods).toHaveBeenCalledWith(expect.objectContaining({ text: 'eggs at breakfast and tea later', date }));
    expect(h.mealCommands.placeCapturedFoods.mock.calls[0][1]).toMatchObject({ logId: 'new', placements: { eggs: 'morning', tea: 'night' } });
    expect(result).toMatchObject({ kind: 'added', undoToken: 'meal-p', logId: 'new', message: 'Logged 3 foods' });
  });
  it('keeps a logged dump when meal placement fails', async () => {
    const h = harness(plan({ intent: 'add' }));
    h.reader.assignMeals.mockRejectedValue(new Error('down'));
    expect(await h.run('eggs')).toMatchObject({ committed: true, kind: 'added' });
    expect(h.mealCommands.placeCapturedFoods.mock.calls[0][1].placements).toEqual({});
  });
  it('declines a compound correction without changing anything', async () => {
    const h = harness(plan({ compound: true, toDay: '2026-11-17' }));
    expect(await h.run('move that and make it whole milk')).toMatchObject({ committed: false, outcome: 'no-change' });
    expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
  });
  it('fails plainly when the gateway is unavailable', async () => {
    const h = harness(plan());
    const service = new DayInstructionService({ nutritionItems: {}, reader: { available: false } });
    await expect(service.execute('u', { text: 'x', date, today })).rejects.toMatchObject({ status: 503 });
    expect(h.reader.read).not.toHaveBeenCalled();
  });

  describe('placing a capture that is already committed', () => {
    it('drops placements for unknown foods, dish parts and meals that do not exist', async () => {
      const h = harness(plan({ intent: 'add' }), { dayRows: [...rows, ...dishRows], placements: { eggs: 'morning', ghost: 'night', tea: 'brunch', rice: 'night' } });
      await h.run('eggs and tea');
      expect(h.mealCommands.placeCapturedFoods.mock.calls[0][1].placements).toEqual({ eggs: 'morning' });
    });
    it('still reports the logged food when placing it fails', async () => {
      const h = harness(plan({ intent: 'add' }));
      h.mealCommands.placeCapturedFoods.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
      const result = await h.run('eggs');
      expect(result).toMatchObject({ committed: true, outcome: 'committed', kind: 'added', logId: 'new', message: 'Logged 3 foods' });
      expect(result.undoToken).toBeUndefined();
      expect(h.logger.warn).toHaveBeenCalledWith('health.day_instruction.placement_failed', expect.objectContaining({ error: 'changed' }));
    });
    it('names the day when the parser filed the food elsewhere', async () => {
      const h = harness(plan({ intent: 'add' }), { dayRows: [rows[0]] });
      h.mealCommands.placeCapturedFoods.mockResolvedValue({ committed: true, undoToken: 'meal-p', date: '2026-11-17', items: [] });
      expect((await h.run('eggs yesterday')).message).toBe('Logged Eggs to Yesterday');
    });
    it('reports what the parser said when no food was logged', async () => {
      const h = harness(plan({ intent: 'add' }));
      h.captureFoods.mockResolvedValue({ committed: false, outcome: 'no-food', message: 'No food there' });
      expect(await h.run('hello')).toMatchObject({ committed: false, outcome: 'no-food', message: 'No food there' });
      expect(h.mealCommands.placeCapturedFoods).not.toHaveBeenCalled();
    });
  });

  describe('running the same operation again', () => {
    const childId = call => call.mock.calls[0][1].operationId;
    it('returns a committed move without reading or moving again, even with the foods gone', async () => {
      const first = harness(plan({ target: 'whole_day', toDay: '2026-11-17' }));
      await first.run('all of this was yesterday');
      const stored = { [childId(first.mealCommands.moveFoods)]: { committed: true, undoToken: 'meal-m', toDate: '2026-11-17', toMeal: null, movedCount: 3, items: [] } };
      const again = harness(plan({ intent: 'add' }), { dayRows: [], stored });
      expect(await again.run('all of this was yesterday')).toMatchObject({ committed: true, outcome: 'committed', kind: 'moved', undoToken: 'meal-m', message: 'Moved 3 foods to Yesterday' });
      expect(again.reader.read).not.toHaveBeenCalled();
      expectNoWrites(again);
    });
    it('names the one food of a committed move', async () => {
      const first = harness(plan({ target: 'named', toMeal: 'night' }), { matched: ['tea'] });
      await first.run('tea was a snack');
      const stored = { [childId(first.mealCommands.moveFoods)]: { committed: true, undoToken: 'meal-m', toDate: null, toMeal: 'night', movedCount: 1, items: [{ uuid: 'tea', name: 'Iced tea' }] } };
      expect((await harness(plan(), { stored }).run('tea was a snack')).message).toBe('Moved Iced tea to Snacks');
    });
    it('returns a committed change without asking for a new revision', async () => {
      const first = harness(plan({ intent: 'change' }), { matched: ['milk'] });
      await first.run('whole milk');
      const stored = { [childId(first.mealCommands.execute)]: { committed: true, undoToken: 'meal-a', items: [{ uuid: 'milk', name: 'Whole Milk' }] } };
      const again = harness(plan({ intent: 'change' }), { stored });
      expect(await again.run('whole milk')).toMatchObject({ outcome: 'committed', kind: 'changed', undoToken: 'meal-a', message: 'Updated Whole Milk' });
      expect(again.entryRevisions.propose).not.toHaveBeenCalled();
      expectNoWrites(again);
    });
    it('returns a committed placement without capturing again', async () => {
      const first = harness(plan({ intent: 'add' }));
      await first.run('eggs');
      const stored = { [childId(first.mealCommands.placeCapturedFoods)]: { committed: true, undoToken: 'meal-p', date, items: [{ uuid: 'eggs', name: 'Eggs', logId: 'new' }] } };
      const again = harness(plan({ intent: 'add' }), { stored });
      expect(await again.run('eggs')).toMatchObject({ outcome: 'committed', kind: 'added', undoToken: 'meal-p', logId: 'new', message: 'Logged Eggs' });
      expectNoWrites(again);
    });
    it('never treats two requests without an operation ID as the same one', async () => {
      const h = harness(plan({ toDay: '2026-11-17' }));
      await h.run('move that to yesterday', { operationId: undefined });
      await h.run('move that to yesterday', { operationId: undefined });
      const [first, second] = h.mealCommands.moveFoods.mock.calls.map(call => call[1].operationId);
      expect(first).not.toBe(second);
    });
  });

  describe('readings that cannot be acted on', () => {
    it('declines a compound request even when it reads as new food', async () => {
      const h = harness(plan({ intent: 'add', compound: true }));
      expect(await h.run('log eggs and fix the milk')).toMatchObject({ committed: false, outcome: 'no-change', message: 'Please make one change at a time.' });
      expectNoWrites(h);
    });
    it('declines a request it cannot carry out', async () => {
      const h = harness(plan({ intent: 'other' }));
      expect(await h.run('delete the milk')).toEqual({ instructionText: 'delete the milk', committed: false, outcome: 'no-change', message: "I can log food, move it, or correct it. I can't do that here." });
      expectNoWrites(h);
    });
    it.each([
      ['an unclear target', { target: 'unclear', toDay: '2026-11-17' }],
      ['a meal target with no meal named', { target: 'meal', fromMeal: 'none', toDay: '2026-11-17' }],
    ])('asks which food for %s instead of moving everything', async (_label, extra) => {
      const h = harness(plan(extra));
      expect(await h.run('move it')).toMatchObject({ committed: false, outcome: 'clarification', clarification: { kind: 'food' } });
      expectNoWrites(h);
      await h.run('move it', { resolved: { foodId: 'eggs' } });
      expect(h.mealCommands.moveFoods.mock.calls[0][1].selectedIds).toEqual(['eggs']);
    });
    it('asks which food to change when the target is unclear', async () => {
      const h = harness(plan({ intent: 'change', target: 'unclear' }), { matched: ['milk'] });
      expect((await h.run('that was wrong')).clarification).toMatchObject({ kind: 'food' });
      expect(h.reader.matchFoods).not.toHaveBeenCalled();
      expect(h.entryRevisions.propose).not.toHaveBeenCalled();
    });
    it('says so when no food on the day can be changed', async () => {
      const h = harness(plan({ intent: 'change' }), { dayRows: [{ uuid: 'loose', name: 'Loose', date, version: 1 }] });
      expect(await h.run('that was whole milk')).toMatchObject({ committed: false, outcome: 'no-change' });
      expectNoWrites(h);
    });
    it.each(['read', 'matchFoods'])('writes nothing and answers 503 when %s fails', async method => {
      const h = harness(plan({ target: 'named', toMeal: 'night' }));
      h.reader[method].mockRejectedValue(new Error('Invalid decision answer: target'));
      await expect(h.run('move the tea')).rejects.toMatchObject({ status: 503, code: 'DAY_INPUT_UNAVAILABLE' });
      expectNoWrites(h);
    });
    it('does not send a move that changes nothing', async () => {
      const h = harness(plan({ toMeal: 'afternoon' }));
      expect(await h.run('that was lunch')).toMatchObject({ committed: false, outcome: 'no-change' });
      expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
    });
    it('treats the viewed day as no day change', async () => {
      const h = harness(plan({ toDay: 'older' }));
      expect(await h.run('that was today', { resolved: { toDate: date } })).toMatchObject({ committed: false, outcome: 'no-change' });
      expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
    });
  });

  describe('dishes', () => {
    const named = extra => plan({ target: 'named', toMeal: 'night', ...extra });
    it('moves a dish by its header, covering every part however it is linked', async () => {
      const h = harness(named(), { dayRows: dishRows, matched: ['dish-uuid', 'rice'] });
      expect((await h.run('the burrito was a snack')).message).toBe('Moved Burrito to Snacks');
      expect(h.reader.matchFoods.mock.calls[0][0].foods).toEqual([{ id: 'dish-uuid', name: 'Burrito', description: 'Burrito, Rice, Beans' }]);
      const command = h.mealCommands.moveFoods.mock.calls[0][1];
      expect(command.selectedIds).toEqual(['dish-uuid']);
      expect(command.expectedVersions).toEqual({ 'dish-uuid': 3, rice: 4, beans: 5, 'old-part': 6 });
    });
    it('never offers or accepts a part as a move target', async () => {
      const h = harness(named(), { dayRows: dishRows });
      expect((await h.run('move the rice')).clarification.choices).toEqual([{ id: 'dish-uuid', label: 'Burrito' }]);
      await expect(h.run('move the rice', { resolved: { foodId: 'rice' } })).rejects.toMatchObject({ status: 422 });
      expect(h.mealCommands.moveFoods).not.toHaveBeenCalled();
    });
    it('changes a part with the version of its dish, which the amend checks', async () => {
      const h = harness(plan({ intent: 'change', target: 'named' }), { dayRows: dishRows, matched: ['rice'] });
      await h.run('that rice was brown rice');
      expect(h.mealCommands.execute.mock.calls[0][1]).toMatchObject({ selectedIds: ['rice'], bucket: 'afternoon', expectedVersions: { rice: 4, 'dish-uuid': 3 } });
    });
    it('sends versions the real commands accept for a dish and for one of its parts', async () => {
      const mutateEntries = vi.fn(async (_user, { updates, resultMeta }) => ({ ...resultMeta, items: [], affectedIds: updates.map(update => update.id), affectedDates: [date] }));
      const store = { findByDate: async () => dishRows, runOperation: (_user, _id, _payload, action) => action(), mutateEntries };
      const mealCommands = new MealFoodCommands({ nutritionItems: store });
      const decide = (reading, matched) => new DayInstructionService({ nutritionItems: store, mealCommands, entryRevisions: { propose: async () => ({ proposal: { name: 'Brown Rice' } }) },
        reader: { available: true, read: async () => reading, matchFoods: async () => matched } });
      await decide(named({ toDay: '2026-11-17' }), ['dish-uuid']).execute('u', { text: 'the burrito was yesterday', date, today, operationId: 'move' });
      expect(mutateEntries.mock.calls[0][1].updates.map(update => update.id)).toEqual(['dish-uuid', 'rice', 'beans', 'old-part']);
      await decide(plan({ intent: 'change', target: 'named' }), ['rice']).execute('u', { text: 'that was brown rice', date, today, operationId: 'change' });
      expect(mutateEntries.mock.calls[1][1].updates.map(update => update.id)).toEqual(['rice']);
    });
  });

  describe('correcting a food', () => {
    const milk = extra => ({ ...rows[2], ...extra });
    const change = (proposal, manualFields = [], dayRows = [milk()]) => {
      const h = harness(plan({ intent: 'change' }), { dayRows: dayRows.map(row => ({ ...row, manualFields })) });
      h.entryRevisions.propose.mockResolvedValue({ proposal, pinned: ['ignored because the row decides'] });
      return h;
    };
    const sent = h => h.mealCommands.execute.mock.calls[0][1].changes.milk;
    it('leaves the quantity alone on a food with no gram mass', async () => {
      const h = change({ name: 'Whole Milk', grams: 240, amount: 240, unit: 'g', calories: 149 }, [], [milk({ grams: null, amount: 1, unit: 'cup' })]);
      await h.run('that was whole milk');
      expect(sent(h)).toEqual({ name: 'Whole Milk', calories: 149 });
    });
    it('holds back hand-set fields and says so', async () => {
      const h = change({ name: 'Whole Milk', calories: 149 }, ['calories']);
      expect((await h.run('that was whole milk')).message).toBe('Changed Milk to Whole Milk. I kept the details you set by hand.');
      expect(sent(h)).toEqual({ name: 'Whole Milk' });
    });
    it('treats the quantity as one thing when any part of it was set by hand', async () => {
      const h = change({ name: 'Whole Milk', grams: 240, amount: 240, unit: 'g' }, ['grams']);
      await h.run('that was whole milk');
      expect(sent(h)).toEqual({ name: 'Whole Milk' });
    });
    it('writes nothing when every proposed field was set by hand', async () => {
      const h = change({ name: 'Whole Milk' }, ['name']);
      expect(await h.run('that was whole milk')).toMatchObject({ committed: false, outcome: 'no-change', message: 'Those details were set by hand, so I left them.' });
      expectNoWrites(h);
    });
    it('never replaces a known nutrient with an unknown one', async () => {
      const h = change({ name: 'Whole Milk', protein: null, fat: null }, [], [milk({ protein: 8 })]);
      await h.run('that was whole milk');
      expect(sent(h)).toEqual({ name: 'Whole Milk', fat: null });
    });
    it('treats a hand-set label as a hand-set name', async () => {
      const h = change({ name: 'Whole Milk', calories: 149 }, ['label']);
      await h.run('that was whole milk');
      expect(sent(h)).toEqual({ calories: 149 });
    });
    it('reads fields tidied by the auditor as pinned too', async () => {
      const h = harness(plan({ intent: 'change' }), { dayRows: [milk({ cleanupFields: ['calories'] })] });
      h.entryRevisions.propose.mockResolvedValue({ proposal: { name: 'Whole Milk', calories: 149 } });
      await h.run('that was whole milk');
      expect(sent(h)).toEqual({ name: 'Whole Milk' });
    });
    it('does not pin what an earlier voice correction wrote', async () => {
      const h = harness(plan({ intent: 'change' }), { dayRows: [milk({ manualFields: ['name', 'calories'], revisedFields: ['name'] })] });
      h.entryRevisions.propose.mockResolvedValue({ proposal: { name: 'Skim Milk', calories: 80 } });
      await h.run('actually skim milk');
      expect(sent(h)).toEqual({ name: 'Skim Milk' });
    });
    it('marks the amend as a voice correction outside the request body', async () => {
      const h = change({ name: 'Whole Milk' });
      await h.run('that was whole milk');
      const [, body, options] = h.mealCommands.execute.mock.calls[0];
      expect(options).toEqual({ voiceCorrection: true });
      expect(body).not.toHaveProperty('voiceCorrection');
    });
    it('rescales proposed nutrition to a hand-set mass', async () => {
      const h = change({ name: 'Cauliflower Rice', grams: 57, amount: 57, unit: 'g', calories: 14, protein: null, fat: 0.5 }, ['grams', 'fat'], [milk({ grams: 158, amount: 158, fat: 1 })]);
      await h.run('that was cauliflower rice');
      expect(Object.keys(sent(h)).sort()).toEqual(['calories', 'name', 'protein']);
      expect(sent(h).calories).toBeCloseTo(14 * 158 / 57, 8);
      expect(sent(h).calories).toBeCloseTo(38.8, 1);
      expect(sent(h).protein).toBeNull();
    });
    it('does not rescale when the quantity was not held back', async () => {
      const h = change({ name: 'Whole Milk', grams: 100, amount: 100, unit: 'g', calories: 60 });
      await h.run('that was whole milk');
      expect(sent(h).calories).toBe(60);
    });
    it('says "Updated" when the name stayed the same', async () => {
      const h = change({ name: 'Milk', calories: 149 }, []);
      expect((await h.run('that was more milk')).message).toBe('Updated Milk');
    });
    it('passes on a refused correction', async () => {
      const h = change({ name: 'x' }, []);
      h.entryRevisions.propose.mockRejectedValue(Object.assign(new Error('Too long'), { status: 422, code: 'INVALID_REVISION' }));
      await expect(h.run('that was milk')).rejects.toMatchObject({ status: 422, code: 'INVALID_REVISION', message: 'Too long' });
    });
    it.each([[new Error('socket hang up')], [Object.assign(new Error('Upstream'), { status: 429 })]])('answers 503 when the revision fails upstream', async error => {
      const h = change({ name: 'x' }, []);
      h.entryRevisions.propose.mockRejectedValue(error);
      await expect(h.run('that was milk')).rejects.toMatchObject({ status: 503, code: 'DAY_INPUT_UNAVAILABLE' });
      expect(h.logger.warn).toHaveBeenCalledWith('health.day_instruction.revision_failed', expect.objectContaining({ error: error.message }));
      expectNoWrites(h);
    });
  });

  describe('after food is logged', () => {
    it('still reports it when the logged rows cannot be read back', async () => {
      const h = harness(plan({ intent: 'add' }));
      h.nutritionItems.findByLogId.mockRejectedValue(new Error('disk'));
      h.captureFoods.mockResolvedValue({ committed: true, logId: 'new', items: [{ uuid: 'eggs', name: 'Eggs', logId: 'new' }] });
      expect(await h.run('eggs')).toMatchObject({ committed: true, outcome: 'committed', kind: 'added', logId: 'new', message: 'Logged Eggs' });
      expect(h.logger.warn).toHaveBeenCalledWith('health.day_instruction.logged_read_failed', expect.objectContaining({ error: 'disk' }));
    });
    it('finds the capture through its items when no log ID is returned', async () => {
      const h = harness(plan({ intent: 'add' }));
      h.captureFoods.mockResolvedValue({ committed: true, items: [{ uuid: 'eggs', name: 'Eggs', logId: 'from-item' }] });
      expect((await h.run('eggs')).logId).toBe('from-item');
      expect(h.mealCommands.placeCapturedFoods.mock.calls[0][1].logId).toBe('from-item');
    });
    it('does not count foods it cannot see', async () => {
      const h = harness(plan({ intent: 'add' }));
      h.captureFoods.mockResolvedValue({ committed: true });
      expect(await h.run('eggs')).toMatchObject({ committed: true, kind: 'added', message: 'Logged your food' });
      expect(h.mealCommands.placeCapturedFoods).not.toHaveBeenCalled();
    });
  });

  describe('answering a question', () => {
    it.each([['a day with food', rows], ['an empty day', []]])('never logs the words as food on %s', async (_label, dayRows) => {
      const h = harness(plan({ intent: 'add' }), { dayRows });
      expect(await h.run('two weeks ago', { resolved: { toDate: '2026-11-04' } })).toMatchObject({ committed: false, outcome: 'no-change', message: 'Please say that again.' });
      expectNoWrites(h);
    });
  });

  describe('against the real ledger', () => {
    let root, store, commands;
    const yesterday = '2026-11-17';
    const food = (uuid, extra) => ({ uuid, label: uuid, grams: 100, unit: 'g', amount: 100, calories: 50, ...extra });
    const capture = (id, createdAt, items, time = 'afternoon') => store.syncFromLog({ id, userId: 'u', isAccepted: true, status: 'accepted', createdAt, meal: { date, time }, items });
    const lunch = () => capture('cap', '2026-11-18T12:00:00Z', [food('a'), food('b'), food('c')]);
    const child = step => sha256Text(`outer:day:${step}`);
    const ids = async day => (await store.findByDate('u', day)).map(row => row.uuid).sort();
    const stack = (reading, { matched = [], placements = {}, proposal = { name: 'Oat Milk', color: 'green' } } = {}) => {
      const reader = { available: true, read: vi.fn(async () => reading), matchFoods: vi.fn(async () => matched), assignMeals: vi.fn(async () => placements) };
      const entryRevisions = { propose: vi.fn(async () => ({ proposal, pinned: [] })) };
      const logger = { info: vi.fn(), warn: vi.fn() };
      const captureFoods = vi.fn(async () => { await lunch(); return { committed: true, logId: 'cap' }; });
      const service = new DayInstructionService({ nutritionItems: store, reader, mealCommands: commands, entryRevisions, logger });
      return { reader, entryRevisions, logger, captureFoods, run: (text, extra) => service.execute('u', { text, date, today, operationId: 'outer', captureFoods, ...extra }) };
    };
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-instruction-'));
      store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
      commands = new MealFoodCommands({ nutritionItems: store });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('"move that" carries a dish and a loose food from the latest capture', async () => {
      await capture('old', '2026-11-18T08:00:00Z', [food('breakfast')], 'morning');
      await lunch();
      const grouped = await commands.execute('u', { action: 'group', name: 'Soup', date, bucket: 'afternoon', operationId: 'grp', selectedIds: ['a', 'b'], expectedVersions: { a: 1, b: 1 } });
      const header = grouped.items.find(row => row.kind === 'group');
      expect(header.createdAt).toBeUndefined();
      expect(header.logId).toBeUndefined();
      const result = await stack(plan({ toDay: yesterday })).run('move that to yesterday');
      expect(result.message).toBe('Moved 2 foods to Yesterday');
      expect(await ids(date)).toEqual(['breakfast']);
      expect(await ids(yesterday)).toEqual(['a', 'b', 'c', header.uuid].sort());
    });
    it('a move that failed on a stale version can be retried under the same operation', async () => {
      await lunch();
      const h = stack(plan({ toDay: yesterday }));
      h.reader.read.mockImplementationOnce(async () => { await store.update('u', 'a', { calories: 51 }); return plan({ toDay: yesterday }); });
      await expect(h.run('move that to yesterday')).rejects.toMatchObject({ status: 409 });
      expect(store.readOperationResult('u', child('move'))).toBeNull();
      expect(await h.run('move that to yesterday')).toMatchObject({ committed: true, kind: 'moved' });
      expect(await ids(yesterday)).toEqual(['a', 'b', 'c']);
    });
    it('a change that failed on a stale version can be retried under the same operation', async () => {
      await capture('one', '2026-11-18T12:00:00Z', [food('a')]);
      const h = stack(plan({ intent: 'change' }));
      h.entryRevisions.propose.mockImplementationOnce(async () => { await store.update('u', 'a', { calories: 51 }); return { proposal: { name: 'Oat Milk' }, pinned: [] }; });
      await expect(h.run('that was oat milk')).rejects.toMatchObject({ status: 409 });
      expect(await h.run('that was oat milk')).toMatchObject({ committed: true, kind: 'changed' });
    });
    it('a correction changes the colour with the food', async () => {
      await capture('one', '2026-11-18T12:00:00Z', [food('a', { color: 'orange' })]);
      await stack(plan({ intent: 'change' })).run('that was oat milk');
      expect(await store.findByUuid('u', 'a')).toMatchObject({ name: 'Oat Milk', color: 'green', version: 2 });
    });
    it('resumes at placement when the capture finished and placement never ran', async () => {
      await store.runOperation('u', child('capture'), { operation: 'day-capture', text: 'soup', date }, async () => { await lunch(); return { committed: true, logId: 'cap' }; });
      const h = stack(plan({ intent: 'change' }), { placements: { a: 'night' } });
      expect(await h.run('soup')).toMatchObject({ committed: true, kind: 'added', logId: 'cap', message: 'Logged 3 foods', undoToken: expect.stringMatching(/^meal-/) });
      expect(h.reader.read).not.toHaveBeenCalled();
      expect(h.captureFoods).not.toHaveBeenCalled();
      expect(await ids(date)).toEqual(['a', 'b', 'c']);
      expect(await store.findByUuid('u', 'a')).toMatchObject({ mealTime: 'night' });
    });
    it('does not capture twice when the reply to a committed capture was lost', async () => {
      const h = stack(plan({ intent: 'add' }));
      h.captureFoods.mockImplementationOnce(async () => { await lunch(); throw new Error('connection lost'); });
      await expect(h.run('soup')).rejects.toThrow('connection lost');
      expect(await h.run('soup')).toMatchObject({ committed: true, kind: 'added', logId: 'cap', message: 'Logged 3 foods' });
      expect(h.captureFoods).toHaveBeenCalledTimes(1);
      expect(await store.findByLogId('u', 'cap')).toHaveLength(3);
    });
    describe('saveMany-shaped rows, which carry no capture time', () => {
      const saved = (uuid, logId, extra) => ({ uuid, userId: 'u', name: uuid, date, mealTime: 'afternoon', grams: 100, unit: 'g', amount: 100, calories: 50, logId, ...extra });
      // Rows written before the ledger kept a time for every save.
      const dropTimes = () => {
        const file = path.join(root, 'lifelog/nutrition/nutrilist');
        saveYamlToPathAtomic(`${file}.yml`, loadYaml(file).map(({ createdAt: _createdAt, ...row }) => row));
      };
      it('"that" means the last capture in ledger order', async () => {
        await store.saveMany([saved('eggs', 'first', { mealTime: 'morning' })]);
        await store.saveMany([saved('tea', 'second'), saved('milk', 'second')]);
        dropTimes();
        expect((await store.findByDate('u', date)).map(row => row.uuid)).toEqual(['eggs', 'tea', 'milk']);
        const h = stack(plan({ toDay: yesterday }));
        await h.run('move that to yesterday');
        expect(h.reader.read.mock.calls[0][0].latest).toEqual(['tea', 'milk']);
        expect(await ids(yesterday)).toEqual(['milk', 'tea']);
        expect(await ids(date)).toEqual(['eggs']);
      });
      it('a dish header added later does not hide the rest of that capture', async () => {
        await store.saveMany([saved('eggs', 'first')]);
        await store.saveMany([saved('a', 'second'), saved('b', 'second'), saved('c', 'second')]);
        const grouped = await commands.execute('u', { action: 'group', name: 'Soup', date, bucket: 'afternoon', operationId: 'grp', selectedIds: ['a', 'b'], expectedVersions: { a: 1, b: 1 } });
        const header = grouped.items.find(row => row.kind === 'group');
        dropTimes();
        await stack(plan({ toDay: yesterday })).run('move that to yesterday');
        expect(await ids(yesterday)).toEqual(['a', 'b', 'c', header.uuid].sort());
      });
      it('a capture with a time beats older rows without one', async () => {
        await store.saveMany([saved('legacy', 'first')]);
        dropTimes();
        await store.saveMany([saved('new', 'second', { createdAt: '2026-11-18 12:00:00' })]);
        await stack(plan({ toDay: yesterday })).run('move that to yesterday');
        expect(await ids(yesterday)).toEqual(['new']);
      });
      it('takes only the last row of unstamped foods under a shared log ID', async () => {
        await store.saveMany([saved('bar', undefined, { log_uuid: 'QUICKADD' })]);
        await store.saveMany([saved('apple', undefined, { log_uuid: 'QUICKADD' })]);
        dropTimes();
        await stack(plan({ toDay: yesterday })).run('move that to yesterday');
        expect(await ids(yesterday)).toEqual(['apple']);
      });

      describe('foods added outside the parser', () => {
        const at = time => vi.setSystemTime(new Date(`2026-11-18T${time}:00Z`));
        const quickAdd = (uuid, extra) => store.saveMany([saved(uuid, undefined, { log_uuid: 'QUICKADD', ...extra })]);
        const moveThat = () => stack(plan({ toDay: yesterday })).run('move that to yesterday');
        beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); at('20:00'); });
        afterEach(() => vi.useRealTimers());
        it('a quick-add after a capture is what "that" means', async () => {
          await store.saveMany([saved('tea', 'cap', { createdAt: '2026-11-18 12:00:00' })]);
          at('20:05');
          await quickAdd('bar');
          await moveThat();
          expect(await ids(yesterday)).toEqual(['bar']);
          expect(await ids(date)).toEqual(['tea']);
        });
        it('two quick-adds stay separate acts', async () => {
          await quickAdd('bar');
          at('20:05');
          await quickAdd('apple');
          await moveThat();
          expect(await ids(yesterday)).toEqual(['apple']);
          expect(await ids(date)).toEqual(['bar']);
        });
        it('a copy of an older food counts from when it was copied', async () => {
          await store.saveMany([saved('old', 'past', { date: yesterday, createdAt: '2026-11-17 09:00:00' })]);
          await store.saveMany([saved('tea', 'cap', { createdAt: '2026-11-18 12:00:00' })]);
          at('20:05');
          await new HealthOperations({ nutritionItems: store }).copyNutritionItems('u', { entryIds: ['old'], date, mealTime: 'afternoon', operationId: 'copy' });
          const copy = (await store.findByDate('u', date)).find(row => row.copiedFrom === 'old');
          expect(copy.createdAt).toBe('2026-11-18 12:05:00');
          await moveThat();
          expect(await ids(date)).toEqual(['tea']);
          expect(await ids(yesterday)).toEqual([copy.uuid, 'old'].sort());
        });
        it('foods saved together under a shared ID move together', async () => {
          await quickAdd('bar');
          at('20:05');
          await store.saveMany([saved('rice', undefined, { log_uuid: 'SAVEDMEAL' }), saved('beans', undefined, { log_uuid: 'SAVEDMEAL' })]);
          await moveThat();
          expect(await ids(yesterday)).toEqual(['beans', 'rice']);
        });
        it('the foods of one parsed capture move together', async () => {
          await quickAdd('bar');
          at('20:05');
          await capture('parsed', '2026-11-18 12:05:00', [food('eggs'), food('toast'), food('jam')]);
          await moveThat();
          expect(await ids(yesterday)).toEqual(['eggs', 'jam', 'toast']);
          expect(await ids(date)).toEqual(['bar']);
        });
        it('one parsed capture stays whole even if only some rows have a time', async () => {
          await store.saveMany([saved('eggs', 'parsed'), saved('toast', 'parsed')]);
          dropTimes();
          await store.saveMany([saved('jam', 'parsed')]);
          await moveThat();
          expect(await ids(yesterday)).toEqual(['eggs', 'jam', 'toast']);
        });
      });
    });
    describe('corrections on the ledger', () => {
      const row = () => store.findByUuid('u', 'a');
      const correction = (proposal, operationId) => {
        const h = stack(plan({ intent: 'change' }), { proposal });
        return h.run('that was something else', { operationId });
      };
      const saveFood = extra => store.saveMany([{ uuid: 'a', userId: 'u', name: 'Milk', date, mealTime: 'afternoon', grams: 100, unit: 'g', amount: 100, calories: 60, protein: 3, logId: 'l', ...extra }]);
      it('keeps a hand-set nutrient when the quantity changes', async () => {
        await saveFood({ protein: 9, manualFields: ['protein'] });
        await correction({ name: 'Whole Milk', grams: 200, amount: 200, unit: 'g' }, 'one');
        expect(await row()).toMatchObject({ grams: 200, protein: 9, calories: 120 });
      });
      it('applies a second voice correction and keeps both protected from the auditor', async () => {
        await saveFood();
        await correction({ name: 'Whole Milk', calories: 149 }, 'one');
        expect(await row()).toMatchObject({ name: 'Whole Milk', calories: 149, revisedFields: expect.arrayContaining(['name', 'calories']), manualFields: expect.arrayContaining(['name', 'calories']) });
        expect(await correction({ name: 'Skim Milk', calories: 83 }, 'two')).toMatchObject({ committed: true, message: 'Changed Whole Milk to Skim Milk' });
        expect(await row()).toMatchObject({ name: 'Skim Milk', calories: 83, manualFields: expect.arrayContaining(['name', 'calories']) });
      });
      it('pins a field again after a hand edit through the meal amend', async () => {
        await saveFood();
        await correction({ name: 'Whole Milk', calories: 149 }, 'one');
        await commands.execute('u', { action: 'amend', date, bucket: 'afternoon', operationId: 'hand', selectedIds: ['a'], expectedVersions: { a: 2 }, changes: { a: { calories: 100 } } });
        expect((await row()).revisedFields).toEqual(['name']);
        await correction({ name: 'Skim Milk', calories: 83 }, 'two');
        expect(await row()).toMatchObject({ name: 'Skim Milk', calories: 100 });
      });
      it('pins a field again after a hand edit of the entry', async () => {
        await saveFood();
        await correction({ name: 'Whole Milk', calories: 149 }, 'one');
        await new HealthOperations({ nutritionItems: store }).updateNutritionItem('u', 'a', { calories: 100 });
        await correction({ name: 'Skim Milk', calories: 83 }, 'two');
        expect(await row()).toMatchObject({ name: 'Skim Milk', calories: 100 });
      });
      it('pins a field again after a numeric edit of the entry', async () => {
        await saveFood();
        await correction({ name: 'Whole Milk', calories: 149 }, 'one');
        await new HealthOperations({ nutritionItems: store }).updateNutritionItem('u', 'a', { numericEdit: { field: 'calories', value: 100 } });
        await correction({ name: 'Skim Milk', calories: 83 }, 'two');
        expect(await row()).toMatchObject({ name: 'Skim Milk', calories: 100 });
      });
      it('Undo restores which fields a voice correction had set', async () => {
        await saveFood();
        await correction({ name: 'Whole Milk', calories: 149 }, 'one');
        const before = await row();
        const second = await correction({ name: 'Skim Milk', protein: 8 }, 'two');
        expect((await row()).revisedFields).toContain('protein');
        await commands.undo('u', { undoToken: second.undoToken, operationId: 'undo' });
        expect(await row()).toMatchObject({ name: 'Whole Milk', revisedFields: before.revisedFields, manualFields: before.manualFields });
      });
    });
    it('retries once when a stale pending record blocks a write', async () => {
      await lunch();
      await expect(store.runOperation('u', child('move'), { operation: 'older-attempt' }, async () => { throw new Error('crashed'); })).rejects.toThrow('crashed');
      expect(await stack(plan({ toDay: yesterday })).run('move that to yesterday')).toMatchObject({ committed: true, kind: 'moved' });
      expect(await ids(yesterday)).toEqual(['a', 'b', 'c']);
    });
    it('does not retry a conflict with a finished operation', async () => {
      await lunch();
      vi.spyOn(store, 'readOperationResult').mockReturnValue(null);
      await store.runOperation('u', child('move'), { operation: 'finished' }, async () => ({ committed: true }));
      const move = vi.spyOn(commands, 'moveFoods');
      await expect(stack(plan({ toDay: yesterday })).run('move that to yesterday')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(move).toHaveBeenCalledTimes(1);
    });
    it('lets a capture that wrote nothing run again', async () => {
      const h = stack(plan({ intent: 'add' }));
      h.captureFoods.mockImplementationOnce(async () => { throw new Error('parser down'); });
      await expect(h.run('soup')).rejects.toThrow('parser down');
      expect(await h.run('soup')).toMatchObject({ committed: true, kind: 'added' });
      expect(h.captureFoods).toHaveBeenCalledTimes(2);
    });
    it('stores only the fields a resumed capture needs', async () => {
      const h = stack(plan({ intent: 'add' }));
      h.captureFoods.mockImplementationOnce(async () => { await lunch(); return { committed: true, logId: 'cap', message: 'ok', photos: [{ imageSource: 'large' }], messages: ['hi'] }; });
      await h.run('soup');
      expect(store.readOperationResult('u', child('capture'))).toEqual({ committed: true, logId: 'cap', message: 'ok' });
    });
    it('keeps an Undo for the capture when placement fails', async () => {
      const h = stack(plan({ intent: 'add' }));
      vi.spyOn(commands, 'placeCapturedFoods').mockRejectedValue(new Error('no placement'));
      const result = await h.run('soup');
      expect(result).toMatchObject({ committed: true, kind: 'added', undoToken: expect.stringMatching(/^meal-/) });
      await commands.undo('u', { undoToken: result.undoToken, operationId: 'undo' });
      expect(await ids(date)).toEqual([]);
    });
    it('still reports the food when that Undo cannot be recorded either', async () => {
      const h = stack(plan({ intent: 'add' }));
      vi.spyOn(commands, 'placeCapturedFoods').mockRejectedValue(new Error('no placement'));
      vi.spyOn(store, 'recordCaptureUndo').mockRejectedValue(new Error('no undo'));
      const result = await h.run('soup');
      expect(result).toMatchObject({ committed: true, kind: 'added', message: 'Logged 3 foods' });
      expect(result.undoToken).toBeUndefined();
      expect(h.logger.warn).toHaveBeenCalledWith('health.day_instruction.capture_undo_failed', expect.objectContaining({ error: 'no undo' }));
    });
  });
});
