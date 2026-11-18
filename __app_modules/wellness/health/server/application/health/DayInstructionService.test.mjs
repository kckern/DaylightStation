import { describe, it, expect, vi } from 'vitest';
import { DayInstructionService } from './DayInstructionService.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';

const date = '2026-11-18', today = date;
const rows = [
  { uuid: 'eggs', name: 'Eggs', date, mealTime: 'morning', logId: 'old', createdAt: '2026-11-18T08:00:00Z', version: 1 },
  { uuid: 'tea', name: 'Iced tea', date, mealTime: 'afternoon', logId: 'new', createdAt: '2026-11-18T12:00:00Z', version: 2 },
  { uuid: 'milk', name: 'Milk', date, mealTime: 'afternoon', logId: 'new', createdAt: '2026-11-18T12:00:00Z', version: 1 },
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
    expect(command.changes.milk).toEqual({ name: 'Whole Milk', grams: 240, amount: 240, unit: 'g', calories: 149 });
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
      expect(await again.run('whole milk')).toMatchObject({ outcome: 'committed', kind: 'changed', undoToken: 'meal-a', message: 'Changed to Whole Milk' });
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
});
