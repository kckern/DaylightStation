import { describe, it, expect } from 'vitest';
import { MealInstructionService } from './MealInstructionService.mjs';
const rows = [
 { uuid: 'veg', name: 'Roast vegetables', date: '2026-09-06', mealTime: 'evening', grams: 180 },
 { uuid: 'broth', name: 'Vietnamese beef broth', date: '2026-09-06', mealTime: 'evening', grams: 300 },
 { uuid: 'other', name: 'Breakfast broth', date: '2026-09-06', mealTime: 'morning', grams: 200 },
];
const input = { date: '2026-09-06', bucket: 'evening', operationId: 'capture-1', text: 'The bone broth had, or the beef broth rather, had some potatoes in it, so add potatoes to the list.' };
function harness(answer) {
 const calls = []; const prompts = [];
 const service = new MealInstructionService({ nutritionItems: { findByDate: async () => rows }, aiGateway: { chat: async prompt => { prompts.push(prompt); return JSON.stringify(answer); } }, mealCommands: { execute: async (user, command) => { calls.push(command); return { committed: true, undoToken: 'undo' }; } } });
 return { service, calls, prompts };
}
describe('MealInstructionService', () => {
 it('loads canonical meal context and adds potatoes to existing broth without replacing broth', async () => {
  const { service, calls, prompts } = harness({ intent: 'amend', targetIds: ['broth'], additions: [{ parentId: 'broth', name: 'Potatoes', grams: 80, calories: 62, protein: 2, carbs: 14, fat: 0, fiber: 1, sugar: 1, sodium: 5, cholesterol: 0 }] });
  expect(await service.execute('alice', input)).toMatchObject({ committed: true, undoToken: 'undo' });
  const context = JSON.parse(prompts[0][0].content.split('Context: ')[1].split('\nInstruction:')[0]);
  expect(context.items.map(row => row.uuid)).toEqual(['veg', 'broth']);
  expect(context.items.find(row => row.uuid === 'broth')).toMatchObject({ name: 'Vietnamese beef broth', grams: 300 });
  expect(calls[0]).toMatchObject({ action: 'amend', selectedIds: ['broth'], additions: [{ parentId: 'broth', name: 'Potatoes' }] });
  expect(calls[0].operationId).not.toBe(input.operationId);
 });
 it('selection constrains model targets and malformed targets never write', async () => {
  const { service, calls } = harness({ intent: 'amend', targetIds: ['veg'], changes: { veg: { grams: 200 } } });
  await expect(service.execute('alice', { ...input, selectedIds: ['broth'] })).rejects.toThrow(/scope/i);
  expect(calls).toEqual([]);
 });
 it('ambiguity returns selectable canonical candidates without a write', async () => {
  const { service, calls } = harness({ intent: 'clarification', message: 'Which food?', candidateIds: ['broth', 'veg'] });
  expect(await service.execute('alice', input)).toMatchObject({ committed: false, outcome: 'clarification', clarification: { choices: [{ id: 'broth', label: 'Vietnamese beef broth' }, { id: 'veg', label: 'Roast vegetables' }] } });
  expect(calls).toEqual([]);
 });
 it('smart suggestions are read-only and carry validated IDs and versions', async () => {
  const { service, calls } = harness({ intent: 'group', name: 'Dinner', targetIds: ['veg', 'broth'] });
  expect(await service.suggest('alice', input)).toMatchObject({ committed: false, proposals: [{ name: 'Dinner', selectedIds: ['veg', 'broth'] }] });
  expect(calls).toEqual([]);
 });
 it('ordinary new foods fall through to the existing food parser', async () => {
  const { service, calls } = harness({ intent: 'add' });
  expect(await service.execute('alice', { ...input, text: 'I had roast vegetables and Vietnamese beef broth' })).toBeNull();
  expect(calls).toEqual([]);
 });
});

it('includes recent persisted utterances and does not use client-supplied meal context', async () => {
 const prompts = [];
 const service = new MealInstructionService({ nutritionItems: { findByDate: async () => rows.map(row => ({ ...row, logId: 'saved-log' })) }, foodLogStore: { findById: async () => ({ text: 'I had roast vegetables and Vietnamese beef broth' }) }, aiGateway: { chat: async prompt => { prompts.push(prompt); return '{"intent":"add"}'; } } });
 await service.execute('alice', { ...input, mealContext: [{ name: 'Invented client food' }] });
 expect(prompts[0][0].content).toContain('I had roast vegetables and Vietnamese beef broth');
 expect(prompts[0][0].content).not.toContain('Invented client food');
});

it('persists the observed potatoes correction once and Undo preserves the original broth and vegetables', async () => {
 const fs = await import('node:fs');
 const os = await import('node:os');
 const path = await import('node:path');
 const { YamlNutriListDatastore } = await import('#adapters/persistence/yaml/YamlNutriListDatastore.mjs');
 const { MealFoodCommands } = await import('./MealFoodCommands.mjs');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-instruction-'));
 try {
  const store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: {} });
  await store.saveMany(rows.map(row => ({ ...row, userId: 'alice', calories: row.uuid === 'broth' ? 90 : 130, protein: 6, photoRef: 'original-photo', nutrientProvenance: { protein: { source: 'user' } } })));
  const before = await store.findByDate('alice', input.date);
  const commands = new MealFoodCommands({ nutritionItems: store });
  const service = new MealInstructionService({ nutritionItems: store, mealCommands: commands, aiGateway: { chat: async () => JSON.stringify({ intent: 'amend', targetIds: ['broth'], additions: [{ name: 'Potatoes', parentId: 'broth', grams: 80, calories: 62 }] }) } });
  const result = await service.execute('alice', input);
  const after = await store.findByDate('alice', input.date);
  expect(after.filter(row => row.name === 'Vietnamese beef broth' && row.kind !== 'group')).toHaveLength(1);
  expect(after.find(row => row.uuid === 'broth')).toMatchObject({ calories: 90, grams: 300, photoRef: 'original-photo' });
  expect(after.filter(row => row.kind !== 'group').reduce((sum, row) => sum + row.calories, 0)).toBe(before.reduce((sum, row) => sum + row.calories, 0) + 62);
  await commands.undo('alice', { undoToken: result.undoToken, operationId: 'undo-instruction' });
  expect((await store.findByDate('alice', input.date)).map(({ version, ...row }) => row)).toEqual(before.map(({ version, ...row }) => row));
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it.each([
 { intent: 'amend', targetIds: ['broth'] },
 { intent: 'amend', targetIds: ['broth'], additions: [{ name: 'Potatoes', calories: 50 }] },
 { intent: 'group', targetIds: ['broth'], name: 'Soup' },
 { intent: 'invented', targetIds: ['broth'] },
])('rejects incomplete or unsafe instructions without mutation: %j', async answer => {
 const { service, calls } = harness(answer);
 await expect(service.execute('alice', input)).rejects.toThrow();
 expect(calls).toEqual([]);
});

it('previews multiple disjoint dishes and rejects overlapping memberships', async () => {
 const allRows = [...rows, { uuid: 'rice', name: 'Rice', date: input.date, mealTime: 'evening' }, { uuid: 'beans', name: 'Beans', date: input.date, mealTime: 'evening' }];
 const answer = { intent: 'groups', groups: [{ name: 'Soup', targetIds: ['veg', 'broth'] }, { name: 'Rice and beans', targetIds: ['rice', 'beans'] }] };
 const { service, calls } = harness(answer);
 service.nutritionItems = { findByDate: async () => allRows };
 expect(await service.suggest('alice', input)).toMatchObject({ groups: [{ name: 'Soup', selectedIds: ['veg', 'broth'] }, { name: 'Rice and beans', selectedIds: ['rice', 'beans'] }] });
 answer.groups[1].targetIds = ['veg', 'beans'];
 await expect(service.suggest('alice', input)).rejects.toThrow(/overlap/i);
 expect(calls).toEqual([]);
});
