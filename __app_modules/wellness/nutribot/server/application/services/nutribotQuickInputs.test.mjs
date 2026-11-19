import { YamlQuickInputLedgerStore } from '../../../../../../__capabilities/quick-input/server/adapters/YamlQuickInputLedgerStore.mjs';
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';
import { LogFoodFromVoice } from '../usecases/LogFoodFromVoice.mjs';
import { LogFoodFromText } from '../usecases/LogFoodFromText.mjs';
import { LogFoodFromImage } from '../usecases/LogFoodFromImage.mjs';
import { AcceptFoodLog } from '../usecases/AcceptFoodLog.mjs';
import { YamlFoodLogDatastore } from '../../../../health/server/adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '../../../../health/server/adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlNutritionSurfaceCheckpoints } from '../../../../health/server/adapters/persistence/yaml/YamlNutritionSurfaceCheckpoints.mjs';
import { YamlFoodCatalogDatastore } from '../../../../health/server/adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { FoodCatalogService } from '../../../../health/server/application/health/FoodCatalogService.mjs';
import { FoodLogReview } from '../../../../health/server/application/nutrition/FoodLogReview.mjs';
import { NutritionReceiptPublisher } from '../../../../health/server/application/nutrition/NutritionReceiptPublisher.mjs';
import { NutritionReceiptRenderer } from '../../../../health/server/rendering/NutritionReceiptRenderer.mjs';
import { createNutriLog } from '../../../../health/server/nutrition-records.mjs';

import { describe, it, expect, vi } from 'vitest';
import { createNutribotQuickInputs } from './nutribotQuickInputs.mjs';

const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);          // 12:00 in Los Angeles
const HOUR = 60 * 60 * 1000;

function memoryStore() {
  const files = new Map();
  return {
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

/** A stand-in for NutribotInputRouter that records the events it is handed. */
function build({ answer = { ok: true, result: { success: true, nutrilogUuid: 'log-1' }, logId: 'log-1' }, available = true, limits } = {}) {
  const events = [];
  const handle = (type) => async (event, responseContext) => {
    events.push({ type, event, responseContext });
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(event) : answer;
  };
  const quick = createNutribotQuickInputs({
    available,
    inputRouter: { handleText: handle('text'), handleVoice: handle('voice'), handleImage: handle('image') },
    ledgerStore: memoryStore(),
    limits,
    timezone: () => 'America/Los_Angeles',
    deviceConfig: (key) => ({ phone: { quick_input: { nutribot: ['user_1'] } } })[key],
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error('no such user');
      return 'telegram:b9_c2';
    },
    clock: () => NOW,
    logger: {},
  });
  return { quick, events };
}

const command = (over = {}) => ({
  conversationId: 'telegram:b9_c2', username: 'user_1', inputId: 'i1',
  body: Buffer.from('two eggs and toast'), mimeType: 'text/plain', ...over,
});

describe('Nutribot quick inputs', () => {
  it('a typed meal reaches the input router as a text event from this user, with no response context', async () => {
    const { quick, events } = build();
    const result = await quick.endpoints.text.submit(command({ body: Buffer.from('  two eggs and toast \n') }));
    expect(result).toEqual({ kind: 'accepted', inputId: 'i1' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    expect(events[0].responseContext).toBeNull();
    expect(events[0].event).toEqual({
      platform: 'quick-input', type: 'text', userId: 'user_1', conversationId: 'telegram:b9_c2', messageId: null,
      quickInput: { username: 'user_1', kind: 'text', inputId: 'i1', logId: expect.any(String) },
      payload: { text: 'two eggs and toast' },
    });
  });

  it('a recording reaches it as bytes in place of a Telegram file id', async () => {
    const { quick, events } = build();
    const body = Buffer.from('opus');
    await quick.endpoints.voice.submit(command({ body, mimeType: 'audio/ogg' }));
    expect(events[0].type).toBe('voice');
    expect(events[0].event.payload.fileId).toEqual({ buffer: body, mimeType: 'audio/ogg' });
  });

  it('a photo reaches it as bytes, with no file id and no URL', async () => {
    const { quick, events } = build();
    const body = Buffer.from('jpeg');
    await quick.endpoints.photo.submit(command({ body, mimeType: 'image/jpeg' }));
    expect(events[0].type).toBe('image');
    expect(events[0].event.payload).toEqual({ fileId: null, imageBuffer: body });
  });

  it('an input captured earlier is filed on the day and at the meal it was captured', async () => {
    const { quick, events } = build();
    // Yesterday at 12:30 local, uploaded now.
    await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg', recordedAt: NOW - 24 * HOUR + 30 * 60 * 1000 }));
    expect(events[0].event.payload.date).toBe('2026-11-17');
    expect(events[0].event.payload.bucket).toBe('afternoon');
    // 19:00 local the day before that: an evening meal.
    await quick.endpoints.text.submit(command({ inputId: 'i2', recordedAt: NOW - 41 * HOUR }));
    expect(events[1].event.payload).toMatchObject({ date: '2026-11-16', bucket: 'evening' });
  });

  it('an input with no believable time carries no date, so the bot files it as it would a Telegram message', async () => {
    const { quick, events } = build();
    await quick.endpoints.text.submit(command());
    await quick.endpoints.text.submit(command({ inputId: 'i2', recordedAt: NOW + 2 * HOUR }));
    for (const { event } of events) {
      expect('date' in event.payload).toBe(false);
      expect('bucket' in event.payload).toBe(false);
    }
  });

  it('processes an input once', async () => {
    const { quick, events } = build();
    await quick.endpoints.text.submit(command());
    expect(await quick.endpoints.text.submit(command())).toEqual({ kind: 'duplicate', inputId: 'i1' });
    expect(events).toHaveLength(1);
  });

  it('reads what the bot made of the input', async () => {
    const cases = [
      [{ ok: true, result: { success: false, code: 'NO_FOOD', error: 'No food detected' }, logId: null }, 'unusable_input'],
      [{ ok: true, result: { success: false, code: 'EMPTY_TRANSCRIPTION', error: 'Empty transcription' }, logId: null }, 'empty_transcription'],
      [{ ok: true, result: { success: false, code: 'VOICE_UNAVAILABLE' }, logId: null }, 'unavailable'],
      [{ ok: false, code: 'AI_UNAVAILABLE', error: 'Food analysis is temporarily unavailable.' }, 'unavailable'],
      // An open revision in the chat took the words, as it would a Telegram message.
      [{ ok: true, result: { success: true } }, 'accepted'],
    ];
    for (const [answer, kind] of cases) {
      const { quick } = build({ answer });
      expect((await quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).kind).toBe(kind);
    }
  });

  it('nothing usable is not asked of the bot twice', async () => {
    const { quick, events } = build({ answer: { ok: true, result: { success: false, code: 'NO_FOOD' }, logId: null } });
    await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg' }));
    expect((await quick.endpoints.photo.submit(command({ mimeType: 'image/jpeg' }))).kind).toBe('unusable_input');
    expect(events).toHaveLength(1);
  });

  it('a failed transcription, a refusal with no known cause and a thrown error can all be retried', async () => {
    const failures = [
      { ok: true, result: { success: false, code: 'TRANSCRIBE_FAILED', error: 'socket hang up' }, logId: null },
      { ok: true, result: { success: false, error: 'Revision session expired' }, logId: null },
      new Error('store is down'),
    ];
    for (const answer of failures) {
      const { quick, events } = build({ answer });
      await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow();
      await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow();
      expect(events).toHaveLength(2);
    }
  });

  it('the error for a refusal names the code, never the bot\'s words', async () => {
    const { quick } = build({ answer: { ok: true, result: { success: false, code: 'TRANSCRIBE_FAILED', error: 'the transcript so far: two eggs' }, logId: null } });
    await expect(quick.endpoints.voice.submit(command({ mimeType: 'audio/ogg' }))).rejects.toThrow(/^Nutribot did not take the input: TRANSCRIBE_FAILED$/);
  });

  it('binds devices and users for Nutribot only, and has its own daily allowance', async () => {
    const { quick } = build({ limits: { inputs: 1 } });
    for (const kind of ['voice', 'text', 'photo']) {
      expect(quick.endpoints[kind].available()).toBe(true);
      expect(quick.endpoints[kind].deviceAllowed('fleet:phone', 'user_1')).toBe(true);
      expect(quick.endpoints[kind].deviceAllowed('fleet:phone', 'user_2')).toBe(false);
      expect(quick.endpoints[kind].conversationFor('user_1')).toBe('telegram:b9_c2');
      expect(quick.endpoints[kind].conversationFor('user_2')).toBeNull();
    }
    await quick.endpoints.text.submit(command());
    expect((await quick.endpoints.photo.submit(command({ inputId: 'i2', mimeType: 'image/jpeg' }))).kind).toBe('daily_limit');
  });

  it('is unavailable without the AI gateway, the input router or a ledger', () => {
    expect(build({ available: false }).quick.endpoints.text.available()).toBe(false);
    const noRouter = createNutribotQuickInputs({ inputRouter: null, ledgerStore: memoryStore(), resolveConversationId: () => 'x' });
    expect(noRouter.endpoints.photo.available()).toBe(false);
  });
});

describe('durable Nutribot recovery', () => {
  for (const kind of ['text', 'voice', 'photo']) {
    for (const crash of ['meal', 'catalog', 'projection', 'receipt', 'ledger', 'missing-message', 'unavailable-message', 'empty-binding']) {
      it(`${kind} reopens the same meal after an interrupted ${crash} write`, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-meal-'));
        let now = NOW;
        let shouldFail = true;
        const terminal = { 'missing-message': 'uncertain', 'unavailable-message': 'unavailable', 'empty-binding': 'uncertain' }[crash];
        let message = 10;
        const views = new Map();
        const owner = 'user_1';
        const chat = 'telegram:test';
        const input = { ...command(), conversationId: chat, recordedAt: now };
        const fiber = kind === 'photo' ? 0 : 2;
        const answer = vi.fn(async () => JSON.stringify({ items: [{ name: 'Toast', grams: 40, calories: 110, fiber }] }));
        const logger = { info() {}, warn() {}, debug() {}, error() {} };
        const clock = () => now;
        const start = () => {
          const dataService = { user: {
            resolveDir: (rel, user) => path.join(root, user, rel),
            resolvePath: (rel, user) => path.join(root, user, rel + '.yml'),
          } };
          const catalogStore = new YamlFoodCatalogDatastore({ dataService, logger });
          const saveCatalog = catalogStore.save.bind(catalogStore);
          catalogStore.save = async (entry, user) => {
            await saveCatalog(entry, user);
            if (crash === 'catalog' && shouldFail) throw new Error('catalog saved before crash');
          };
          const catalogService = new FoodCatalogService({ catalogStore, clock: { now: clock }, createId: () => 'catalog-item', logger });
          const logs = new YamlFoodLogDatastore({ configService: { getUserDir: user => path.join(root, user) }, logger });
          const items = new YamlNutriListDatastore({ dataService, logger });
          const saveItems = items.saveMany.bind(items);
          items.saveMany = async rows => {
            await saveItems(rows);
            if (crash === 'projection' && shouldFail) throw new Error('projection saved before crash');
          };
          const reviewService = new FoodLogReview({ foodLogs: logs, items, logger, clock: { now: clock } });
          const checkpoints = new YamlNutritionSurfaceCheckpoints({ dataService });
          const publisher = new NutritionReceiptPublisher({
            destinationFor: () => crash === 'empty-binding' ? null : chat, linkFor: () => null, foodLogs: logs, items, checkpoints, logger,
            renderer: new NutritionReceiptRenderer(),
            surface: { updateMessage: async (_, binding, receipt) => {
              if (crash === 'unavailable-message') throw Object.assign(new Error('deleted message'), { permanent: true });
              if (crash === 'receipt' && shouldFail) throw new Error('receipt failed');
              views.set(binding.messageId, receipt);
            } },
          });
          const send = vi.fn(async () => {
            message++;
            if (crash === 'missing-message') throw new Error('unconfirmed status send');
            return { messageId: String(message) };
          });
          const messagingGateway = { sendMessage: send, sendPhoto: send, updateMessage() {}, deleteMessage() {}, transcribeVoice: async () => 'toast' };
          const deps = { messagingGateway, foodLogStore: logs, catalogService, aiGateway: { chat: answer, chatWithImage: answer }, logger };
          const text = new LogFoodFromText(deps);
          const image = new LogFoodFromImage({ ...deps, imageDownloader: {} });
          const voice = new LogFoodFromVoice({ ...deps, logFoodFromText: text });
          const accept = new AcceptFoodLog({ ...deps, reviewService, nutriListStore: items });
          const router = new NutribotInputRouter({
            getLogFoodFromText: () => text, getLogFoodFromImage: () => image, getLogFoodFromVoice: () => voice,
            getAcceptFoodLog: () => accept, getFoodLogReview: () => reviewService,
            getReceiptPublisher: () => publisher, getFoodLogStore: () => logs,
          }, { logger });
          const save = logs.save.bind(logs);
          logs.save = async log => {
            await save(log);
            if (log.metadata.quickInput && crash === 'meal' && shouldFail) throw new Error('meal saved before crash');
            return log;
          };
          const quick = createNutribotQuickInputs({ inputRouter: router, clock, logger, timezone: () => 'America/Los_Angeles',
            ledgerStore: new YamlQuickInputLedgerStore({ bot: 'nutribot', logger, dataService: { user: {
              read: (rel, user) => loadYaml(path.join(root, user, rel)),
              write(rel, ledger, user) {
                if (crash === 'ledger' && shouldFail && ledger.inputs[kind + ':i1']?.saved) return false;
                saveYamlToPathAtomic(path.join(root, user, rel + '.yml'), ledger);
                return true;
              },
            } } }),
          });
          return { ...quick, logs, items, checkpoints, catalogStore };
        };
        try {
          const first = start();
          const legacy = createNutriLog({ userId: owner, conversationId: chat, timestamp: new Date(now),
            items: [{ label: 'Earlier toast', grams: 40, amount: 1, unit: 'slice', color: 'yellow', calories: 110 }], meal: { date: '2026-11-17', time: 'night' } });
          await first.logs.save(legacy);
          if (terminal) expect(await first.endpoints[kind].submit(input)).toMatchObject({ kind: 'accepted', receiptDelivery: terminal });
          else await expect(first.endpoints[kind].submit(input)).rejects.toThrow();
          const originalMessageCount = message;
          const [original] = (await first.logs.findAll(owner)).filter(log => log.id !== legacy.id);
          expect(original.meal.date).toBe('2026-11-18');
          now += 24 * HOUR;
          shouldFail = false;
          const next = start();
          const replies = await Promise.all([next.endpoints[kind].submit(input), start().endpoints[kind].submit(input)]);
          expect(replies[0]).toMatchObject({ kind: terminal || crash === 'ledger' ? 'duplicate' : 'resumed',
            receiptDelivery: terminal || 'delivered' });
          expect(message).toBe(originalMessageCount);
          expect(answer).toHaveBeenCalledTimes(1);
          const cold = start();
          expect(await cold.endpoints[kind].submit(input)).toMatchObject({ kind: 'duplicate', receiptDelivery: terminal || 'delivered' });
          expect(await cold.logs.findAll(owner)).toHaveLength(2);
          const meal = await cold.logs.findByUuid(original.id, owner);
          expect(meal).toMatchObject({ status: 'accepted', meal: original.meal, metadata: {
            quickInput: { username: owner, inputId: 'i1', kind, finished: true, receiptDelivery: terminal || 'delivered' }, reviewOperation: { complete: true },
          } });
          expect(await cold.items.findByLogId(owner, original.id)).toHaveLength(1);
          const [entry] = await cold.catalogStore.getAll(owner);
          expect(entry.useCount).toBe(1);
          expect(entry.quickInputUsageIds).toEqual([meal.items[0].id]);
          expect(entry.baseNutrients).toMatchObject({ fiber });
          for (const key of ['sodium', 'sugar', 'cholesterol']) expect(entry.baseNutrients).not.toHaveProperty(key);
          if (terminal) expect(views.size).toBe(0);
          else {
            expect((await cold.checkpoints.load(owner)).receipts[original.id].binding.messageId).toBe(original.metadata.messageId);
            expect(views.get(original.metadata.messageId).text).toMatch(/toast/i);
          }
          expect(cold.ledger.usage(owner)).toEqual({ inputs: 0, bytes: 0, attempts: terminal || crash === 'ledger' ? 0 : 1 });
          const otherInput = { ...input, username: 'other' };
          await Promise.all([cold.endpoints[kind].submit(otherInput), start().endpoints[kind].submit(otherInput)]);
          expect(answer).toHaveBeenCalledTimes(2);
          const [other] = await cold.logs.findAll('other');
          expect(other.id).not.toBe(original.id);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
      });
    }
  }
});
