import { it, expect } from 'vitest';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';
it('exposes contextual results and never leaks released progress into committed success', async () => {
 const adapter = new WebNutribotAdapter({ logger: {}, mealInstructions: { execute: async (_u, input) => ({ committed: true, undoToken: 'u', entryIds: ['broth'], items: [], message: `Updated ${input.text}` }) }, inputRouter: { handleText: async (event, rc) => { const status = await rc.createStatusIndicator('Analyzing'); await status.release(); const result = await event.payload.interpretText('broth'); return { committed: result.committed, result, items: [] }; } } });
 expect(await adapter.process({ userId: 'u', date: '2026-09-06', bucket: 'evening', type: 'text', content: 'broth' })).toMatchObject({ committed: true, undoToken: 'u', entryIds: ['broth'], message: 'Updated broth', messages: [] });
});

it('transcribes saved voice through the existing gateway and interprets before the new-food parser', async () => {
 const { NutribotInputRouter } = await import('#apps/nutribot/services/NutribotInputRouter.mjs');
 const { LogFoodFromVoice } = await import('#apps/nutribot/usecases/LogFoodFromVoice.mjs');
 const { LogFoodFromText } = await import('#apps/nutribot/usecases/LogFoodFromText.mjs');
 const { MealInstructionService } = await import('#apps/health/MealInstructionService.mjs');
 const utterance = 'The bone broth had, or the beef broth rather, had some potatoes in it, so add potatoes to the list.';
 const events = [];
 const gateway = { transcribeVoice: async () => { events.push('transcribe'); return utterance; } };
 const text = new LogFoodFromText({ messagingGateway: gateway, aiGateway: { chat: () => { throw Error('New-food parser must not process amendments'); } }, logger: {} });
 const voice = new LogFoodFromVoice({ messagingGateway: gateway, logFoodFromText: text, logger: {} });
 const instructions = new MealInstructionService({ nutritionItems: { findByDate: async () => [{ uuid: 'broth', date: '2026-09-06', mealTime: 'evening', name: 'Vietnamese beef broth' }] }, aiGateway: { chat: async () => JSON.stringify({ intent: 'amend', targetIds: ['broth'], additions: [{ parentId: 'broth', name: 'Potatoes', calories: 60 }] }) }, mealCommands: { execute: async (_u, command) => ({ ...command, committed: true, undoToken: 'undo-broth', entryIds: ['broth', 'potatoes'] }) } });
 const router = new NutribotInputRouter({ getLogFoodFromVoice: () => voice, getLogFoodFromText: () => text }, { logger: {} });
 const adapter = new WebNutribotAdapter({ inputRouter: router, mealInstructions: instructions, voiceMemoStore: { save: async () => { events.push('save'); return 'va_test'; } }, logger: {} });
 const result = await adapter.process({ type: 'voice', content: 'data:audio/webm;base64,b3B1cw==', userId: 'alice', date: '2026-09-06', bucket: 'evening', operationId: 'voice-1', selectedIds: ['broth'] });
 expect(events).toEqual(['save', 'transcribe']);
 expect(result).toMatchObject({ committed: true, undoToken: 'undo-broth', entryIds: ['broth', 'potatoes'], messages: [] });
});

it('replays a committed contextual voice operation after losing the outer response without AI or duplicate food', async () => {
 const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
 const { loadYaml, saveYamlToPathAtomic } = await import('#system/utils/FileIO.mjs');
 const { YamlNutriListDatastore } = await import('#adapters/persistence/yaml/YamlNutriListDatastore.mjs');
 const { MealFoodCommands } = await import('#apps/health/MealFoodCommands.mjs');
 const { MealInstructionService } = await import('#apps/health/MealInstructionService.mjs');
 const { NutribotInputRouter } = await import('#apps/nutribot/services/NutribotInputRouter.mjs');
 const { LogFoodFromVoice } = await import('#apps/nutribot/usecases/LogFoodFromVoice.mjs');
 const { LogFoodFromText } = await import('#apps/nutribot/usecases/LogFoodFromText.mjs');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-replay-'));
 try {
  const store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: {} });
  await store.saveMany([{ uuid: 'broth', name: 'Vietnamese beef broth', userId: 'alice', date: '2026-09-06', mealTime: 'evening', calories: 90, grams: 300 }]);
  let transcriptions = 0, parses = 0;
  const gateway = { transcribeVoice: async () => { transcriptions++; return 'The beef broth had potatoes in it, so add potatoes.'; } };
  const text = new LogFoodFromText({ messagingGateway: gateway, aiGateway: {}, logger: {} });
  const voice = new LogFoodFromVoice({ messagingGateway: gateway, logFoodFromText: text, logger: {} });
  const service = new MealInstructionService({ nutritionItems: store, mealCommands: new MealFoodCommands({ nutritionItems: store }), aiGateway: { chat: async () => { parses++; return JSON.stringify({ intent: 'amend', targetIds: ['broth'], additions: [{ parentId: 'broth', name: 'Potatoes', calories: 60, grams: 80 }] }); } } });
  const adapter = new WebNutribotAdapter({ inputRouter: new NutribotInputRouter({ getLogFoodFromVoice: () => voice }, { logger: {} }), mealInstructions: service, logger: {} });
  const request = { type: 'voice', content: 'data:audio/webm;base64,b3B1cw==', userId: 'alice', date: '2026-09-06', bucket: 'evening', selectedIds: ['broth'], operationId: 'outer-capture' };
  const run = () => store.runOperation('alice', request.operationId, request, () => adapter.process(request));
  const first = await run();
  const file = path.join(root, 'lifelog/nutrition/ledger-operations');
  const operations = loadYaml(file);
  // Simulate process loss immediately after the atomic ledger transaction:
  // only mutationResult survives; neither nested nor outer response was saved.
  for (const operation of Object.values(operations)) { delete operation.result; operation.pending = true; }
  saveYamlToPathAtomic(file + '.yml', operations);
  expect(await run()).toEqual(first);
  expect(transcriptions).toBe(1); expect(parses).toBe(1);
  expect((await store.findByDate('alice', request.date)).filter(row => row.name === 'Potatoes')).toHaveLength(1);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
