/**
 * Auto-commit seam — AI captures land immediately as unsettled.
 *
 * WHAT THE CAPTURE MESSAGE LOOKED LIKE BEFORE (verified in the source):
 *   Each LogFoodFrom* use case builds its own row in a private
 *   `#buildActionButtons(logUuid)` (LogFoodFromText.mjs:580, LogFoodFromImage.mjs:510,
 *   ProcessRevisionInput.mjs:306) and SENDS it itself, from inside execute(),
 *   before returning:
 *
 *     [[ { text: '✅ Accept',  callback_data: '{"cmd":"a","id":<logUuid>}' },
 *        { text: '✏️ Revise',  callback_data: '{"cmd":"r","id":<logUuid>}' },
 *        { text: '🗑️ Discard', callback_data: '{"cmd":"x","id":<logUuid>}' } ]]
 *
 *   delivered as `responseContext.sendMessage(text, { choices, inline: true })`
 *   or `responseContext.updateMessage(msgId, { text|caption, choices, inline: true })`.
 *
 * There is no shared presenter module for that row, but there IS a shared
 * choke point: the `responseContext` the ROUTER hands to every use case. So the
 * seam is two narrow pieces, both in the router — a message seam
 * (`withCommittedChoices` decorating responseContext, rewriting Accept -> Undo/Edit
 * in flight) and an accept seam (stamp `settled:false`, then run AcceptFoodLog).
 */

import { describe, it, expect, vi } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';
import { AcceptFoodLog } from '../usecases/AcceptFoodLog.mjs';
import { DiscardFoodLog } from '../usecases/DiscardFoodLog.mjs';
import { SelectUPCPortion } from '../usecases/SelectUPCPortion.mjs';
import { LogFoodFromText } from '../usecases/LogFoodFromText.mjs';
import { createNutriLog } from '../nutriLogRecords.mjs';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const acceptRow = (logUuid) => [[
  { text: '✅ Accept', callback_data: JSON.stringify({ cmd: 'a', id: logUuid }) },
  { text: '✏️ Revise', callback_data: JSON.stringify({ cmd: 'r', id: logUuid }) },
  { text: '🗑️ Discard', callback_data: JSON.stringify({ cmd: 'x', id: logUuid }) },
]];

const allButtons = (choices) => (choices || []).flat();
const callbackCmds = (choices) => allButtons(choices)
  .map(b => JSON.parse(b.callback_data).cmd);

function makeFoodLogStore() {
  const logs = new Map();
  return {
    logs,
    save: vi.fn(async (log) => { logs.set(log.id, log); return log; }),
    findByUuid: vi.fn(async (id) => logs.get(id) || null),
    updateStatus: vi.fn(async (userId, id, status) => {
      const log = logs.get(id);
      if (!log) return null;
      const updated = log.with(
        { status, ...(status === 'accepted' ? { acceptedAt: '2026-09-02 10:00:00' } : {}) },
        new Date(),
      );
      logs.set(id, updated);
      return updated;
    }),
    findPending: vi.fn(async () => []),
  };
}

function makeResponseContext() {
  const sent = [];
  const updated = [];
  return {
    sent,
    updated,
    sendMessage: vi.fn(async (text, options) => { sent.push({ text, options }); return { messageId: 'bot-1' }; }),
    sendPhoto: vi.fn(async (src, caption, options) => { sent.push({ text: caption, options }); return { messageId: 'bot-2' }; }),
    updateMessage: vi.fn(async (messageId, updates) => { updated.push({ messageId, updates }); }),
    deleteMessage: vi.fn(async () => {}),
  };
}

/** A stand-in for LogFoodFromText: creates a PENDING log and sends the Accept row itself. */
function makeCaptureUseCase(foodLogStore, { items } = {}) {
  return {
    execute: vi.fn(async ({ userId, conversationId, responseContext }) => {
      const log = createNutriLog({
        userId,
        conversationId,
        items: items || [
          { label: 'Apple', icon: 'apple', grams: 180, unit: 'g', amount: 180, color: 'green', calories: 95 },
          { label: 'Toast', icon: 'bread', grams: 40, unit: 'g', amount: 40, color: 'yellow', calories: 120 },
        ],
        meal: { date: '2026-09-02', time: 'morning' },
        timezone: 'America/Los_Angeles',
        timestamp: new Date('2026-09-02T08:00:00Z'),
      });
      await foodLogStore.save(log);
      await responseContext.sendMessage('🕒 Wednesday\n\nApple\nToast', {
        choices: acceptRow(log.id),
        inline: true,
      });
      return { success: true, nutrilogUuid: log.id };
    }),
  };
}

function makeHarness({ conversationState = null, captureUseCase, scaleUseCase, foodLogStore } = {}) {
  foodLogStore = foodLogStore || makeFoodLogStore();
  const nutriListStore = { saveMany: vi.fn(async () => {}), removeByLogId: vi.fn(async () => 2) };
  const messagingGateway = {
    sendMessage: vi.fn(async () => ({ messageId: 'm' })),
    updateMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
  };
  const generateDailyReport = { execute: vi.fn(async () => ({ success: true })) };
  const acceptFoodLog = new AcceptFoodLog({
    messagingGateway, foodLogStore, nutriListStore, generateDailyReport, logger: silentLogger,
  });
  const acceptSpy = vi.spyOn(acceptFoodLog, 'execute');

  const logFoodFromText = captureUseCase || makeCaptureUseCase(foodLogStore);
  const logScaleFoodFromText = scaleUseCase || { execute: vi.fn(async () => ({ success: true })) };

  const container = {
    getConversationStateStore: () => (conversationState === null ? null : {
      get: async () => conversationState,
      clear: async () => {},
    }),
    getFoodLogStore: () => foodLogStore,
    getNutriListStore: () => nutriListStore,
    getMessagingGateway: () => messagingGateway,
    getAcceptFoodLog: () => acceptFoodLog,
    getLogFoodFromText: () => logFoodFromText,
    getLogFoodFromUPC: () => logFoodFromText,
    getLogScaleFoodFromText: () => logScaleFoodFromText,
  };

  const router = new NutribotInputRouter(container, { logger: silentLogger });
  return { router, foodLogStore, nutriListStore, acceptSpy, generateDailyReport, logFoodFromText, logScaleFoodFromText };
}

const textEvent = {
  type: 'text',
  conversationId: 'web:kc',
  userId: 'kc',
  messageId: 'user-1',
  payload: { text: 'apple and toast' },
};

describe('NutribotInputRouter auto-commit seam', () => {
  it('commits a text capture through the accept path with every item settled:false', async () => {
    const { router, foodLogStore, nutriListStore, acceptSpy } = makeHarness();
    const rc = makeResponseContext();

    const out = await router.handleText(textEvent, rc);

    expect(out.committed).toBe(true);
    expect(out.logId).toBeTruthy();

    // The accept path ran (status -> accepted, acceptedAt stamped, nutrilist synced)
    expect(acceptSpy).toHaveBeenCalledTimes(1);
    const stored = foodLogStore.logs.get(out.logId);
    expect(stored.status).toBe('accepted');
    expect(stored.acceptedAt).toBeTruthy();

    // Every nutrilist row carries settled:false, verbatim
    expect(nutriListStore.saveMany).toHaveBeenCalledTimes(1);
    const [rows] = nutriListStore.saveMany.mock.calls[0];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.settled).toBe(false);
      expect(row.logUuid).toBe(out.logId);
    }

    // ...and so does every item on the persisted log itself
    expect(stored.items.map(i => i.settled)).toEqual([false, false]);
    expect(out.items.every(i => i.settled === false)).toBe(true);
  });

  it('the outgoing message offers no Accept — only Undo and Edit', async () => {
    const { router } = makeHarness();
    const rc = makeResponseContext();

    const out = await router.handleText(textEvent, rc);

    expect(rc.sent).toHaveLength(1);
    const choices = rc.sent[0].options.choices;
    const labels = allButtons(choices).map(b => b.text);

    expect(labels.some(t => /Accept/i.test(t))).toBe(false);
    expect(labels.some(t => /Undo/i.test(t))).toBe(true);
    expect(labels.some(t => /Edit/i.test(t))).toBe(true);

    // Existing callback commands are reused: 'x' (REJECT_LOG) and 'r' (REVISE_ITEM)
    expect(callbackCmds(choices).sort()).toEqual(['r', 'x']);
    expect(callbackCmds(choices)).not.toContain('a');
    for (const button of allButtons(choices)) {
      expect(JSON.parse(button.callback_data).id).toBe(out.logId);
    }
  });

  it('leaves non-Accept keyboards (portion pickers, retries) untouched', async () => {
    const portionUseCase = {
      execute: vi.fn(async ({ responseContext }) => {
        await responseContext.sendMessage('Pick a portion', {
          choices: [[{ text: '1 serving', callback_data: JSON.stringify({ cmd: 'p', id: 'x', f: 1 }) }]],
          inline: true,
        });
        return { success: true };
      }),
    };
    const { router } = makeHarness({ captureUseCase: portionUseCase });
    const rc = makeResponseContext();

    await router.handleText(textEvent, rc);

    expect(callbackCmds(rc.sent[0].options.choices)).toEqual(['p']);
  });

  it('does NOT auto-commit the scale path (composition flow stays intact)', async () => {
    const foodLogStore = makeFoodLogStore();
    let scaleLogId = null;
    const scaleUseCase = {
      execute: vi.fn(async ({ userId, conversationId, responseContext }) => {
        const log = createNutriLog({
          userId,
          conversationId,
          items: [{ label: 'Oats', icon: 'bowl', grams: 60, unit: 'g', amount: 60, color: 'yellow', calories: 220 }],
          meal: { date: '2026-09-02', time: 'morning' },
          timezone: 'America/Los_Angeles',
          timestamp: new Date('2026-09-02T08:00:00Z'),
        });
        scaleLogId = log.id;
        await foodLogStore.save(log);
        await responseContext.sendMessage('60g oats', { choices: acceptRow(log.id), inline: true });
        return { success: true, nutrilogUuid: log.id };
      }),
    };

    // Rebuild the harness so the scale use case shares the store it writes to.
    const nutriListStore = { saveMany: vi.fn(async () => {}), removeByLogId: vi.fn(async () => 0) };
    const messagingGateway = { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() };
    const acceptFoodLog = new AcceptFoodLog({ messagingGateway, foodLogStore, nutriListStore, logger: silentLogger });
    const acceptSpy = vi.spyOn(acceptFoodLog, 'execute');
    const container = {
      getConversationStateStore: () => ({
        get: async () => ({ activeFlow: 'scale_describe', flowState: { pendingLogUuid: 'seed-log' } }),
        clear: async () => {},
      }),
      getFoodLogStore: () => foodLogStore,
      getMessagingGateway: () => messagingGateway,
      getAcceptFoodLog: () => acceptFoodLog,
      getLogFoodFromText: () => { throw new Error('scale input must not reach LogFoodFromText'); },
      getLogScaleFoodFromText: () => scaleUseCase,
    };
    const router = new NutribotInputRouter(container, { logger: silentLogger });
    const rc = makeResponseContext();

    const out = await router.handleText({ ...textEvent, payload: { text: 'oatmeal' } }, rc);

    expect(scaleUseCase.execute).toHaveBeenCalledTimes(1);
    // No accept path, no settled stamp, and the Accept keyboard survives.
    expect(acceptSpy).not.toHaveBeenCalled();
    expect(nutriListStore.saveMany).not.toHaveBeenCalled();
    expect(out.committed).toBeUndefined();
    expect(foodLogStore.logs.get(scaleLogId).status).toBe('pending');
    expect(foodLogStore.logs.get(scaleLogId).items[0].settled).toBeUndefined();
    expect(callbackCmds(rc.sent[0].options.choices)).toEqual(['a', 'r', 'x']);
  });

  it('stamps but does not accept a barcode capture (its portion step commits)', async () => {
    const { router, foodLogStore, nutriListStore, acceptSpy } = makeHarness();
    const rc = makeResponseContext();

    const out = await router.handleUpc({ ...textEvent, type: 'upc', payload: { text: '012345678905' } }, rc);

    expect(out.committed).toBe(false);
    expect(acceptSpy).not.toHaveBeenCalled();
    expect(nutriListStore.saveMany).not.toHaveBeenCalled();
    expect(foodLogStore.logs.get(out.logId).status).toBe('pending');
    // Items ARE stamped, so the portion step's rows land unsettled.
    expect(foodLogStore.logs.get(out.logId).items.every(i => i.settled === false)).toBe(true);
  });
});

describe('daily-report cadence', () => {
  it('does NOT fire the daily report on a seam-driven commit', async () => {
    const { router, generateDailyReport, acceptSpy } = makeHarness();
    const rc = makeResponseContext();

    await router.handleText(textEvent, rc);

    // findPending is essentially always empty now, so without autoReport:false a
    // full report (image render + coaching kick) would fire inside every capture.
    expect(acceptSpy.mock.calls[0][0].autoReport).toBe(false);
    expect(generateDailyReport.execute).not.toHaveBeenCalled();
  });
});

describe('Telegram copy for a committed capture (task 1.4)', () => {
  it('reads as already-logged — "Logged ✓ — n items, kcal kcal" — with Undo/Edit, not Accept', async () => {
    const foodLogStore = makeFoodLogStore();
    const aiGateway = {
      chat: vi.fn(async () => JSON.stringify({
        items: [
          { name: 'Apple', grams: 180, calories: 95, noom_color: 'green' },
          { name: 'Toast', grams: 40, calories: 120, noom_color: 'yellow' },
        ],
        date: '2026-09-02',
        time: 'morning',
      })),
    };
    const realLogFoodFromText = new LogFoodFromText({
      messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway,
      foodLogStore,
      logger: silentLogger,
    });

    const { router } = makeHarness({ foodLogStore, captureUseCase: realLogFoodFromText });
    const rc = makeResponseContext();

    const out = await router.handleText(textEvent, rc);

    expect(out.committed).toBe(true);

    // The real LogFoodFromText sends the "Analyzing..." status message, then
    // updates it in place with the committed copy — that update is what the
    // user actually sees.
    expect(rc.updated).toHaveLength(1);
    const { text } = rc.updated[0].updates;

    // Copy reads as a confirmation, not a prompt: no "Accept" anywhere, and an
    // explicit "Logged" + item-count + kcal-total summary line.
    expect(text).toMatch(/^Logged ✓ — 2 items, 215 kcal/);
    expect(text).not.toMatch(/Accept/i);

    // Keyboard is still the committed Undo/Edit row (the message seam), not Accept.
    const buttons = allButtons(rc.updated[0].updates.choices);
    expect(buttons.map(b => b.text).some(t => /Accept/i.test(t))).toBe(false);
    expect(callbackCmds(rc.updated[0].updates.choices).sort()).toEqual(['r', 'x']);
  });
});

describe('barcode portion selection on a stamped log', () => {
  it('writes nutrilist rows carrying settled:false', async () => {
    const { router, foodLogStore, nutriListStore } = makeHarness();
    const rc = makeResponseContext();

    // 1. Scan: the seam stamps settled:false but leaves the log pending.
    const out = await router.handleUpc({ ...textEvent, type: 'upc', payload: { text: '012345678905' } }, rc);
    expect(out.committed).toBe(false);

    // 2. Portion tap: SelectUPCPortion is what actually commits the barcode flow.
    const selectPortion = new SelectUPCPortion({
      messagingGateway: {
        sendMessage: vi.fn(async () => ({ messageId: 'm' })),
        updateMessage: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
      },
      foodLogStore,
      nutriListStore,
      logger: silentLogger,
    });
    await selectPortion.execute({
      userId: 'kc', conversationId: 'web:kc', logUuid: out.logId, portionFactor: 2,
    });

    expect(nutriListStore.saveMany).toHaveBeenCalledTimes(1);
    const [rows] = nutriListStore.saveMany.mock.calls[0];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.settled).toBe(false);
    expect(foodLogStore.logs.get(out.logId).status).toBe('accepted');
  });
});

describe('Undo (discard) of a committed log', () => {
  it('marks the log deleted and removes its nutrilist rows', async () => {
    const foodLogStore = makeFoodLogStore();
    const log = createNutriLog({
      userId: 'kc',
      conversationId: 'web:kc',
      items: [{ label: 'Apple', icon: 'apple', grams: 180, unit: 'g', amount: 180, color: 'green', calories: 95, settled: false }],
      meal: { date: '2026-09-02', time: 'morning' },
      timezone: 'America/Los_Angeles',
      timestamp: new Date('2026-09-02T08:00:00Z'),
    });
    await foodLogStore.save(log);
    await foodLogStore.updateStatus('kc', log.id, 'accepted');

    const nutriListStore = { saveMany: vi.fn(async () => {}), removeByLogId: vi.fn(async () => 1) };
    const discard = new DiscardFoodLog({
      messagingGateway: { deleteMessage: vi.fn(async () => {}) },
      foodLogStore,
      nutriListStore,
      logger: silentLogger,
    });

    const result = await discard.execute({ userId: 'kc', conversationId: 'web:kc', logUuid: log.id });

    expect(result.success).toBe(true);
    expect(foodLogStore.logs.get(log.id).status).toBe('deleted');
    expect(nutriListStore.removeByLogId).toHaveBeenCalledWith('kc', log.id);
  });
});
