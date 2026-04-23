/**
 * Date Bulletproofing Regression Tests
 *
 * Verifies that meal.date is assigned correctly across all combinations
 * of entry-day, accept-day, revision-day, and user text.
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';
import { AcceptFoodLog } from '#apps/nutribot/usecases/AcceptFoodLog.mjs';
import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';

// Fixed clocks for deterministic date behavior
const THU_NOON_PT = new Date('2026-04-16T19:00:00Z'); // Thu 12:00 PT
const FRI_NOON_PT = new Date('2026-04-17T19:00:00Z'); // Fri 12:00 PT

function mockClock(date) {
  // doNotFake: ['setTimeout'] keeps timer-based awaits (e.g. autoreport's 300ms
  // debounce inside AcceptFoodLog) resolving in real time while we control Date.
  jest.useFakeTimers({ doNotFake: ['setTimeout'] });
  jest.setSystemTime(date);
}

function resetClock() {
  jest.useRealTimers();
}

function buildTextDeps(aiResponseForInitial, aiResponseForRevision = null) {
  const messagingGateway = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };
  const aiGateway = {
    chat: jest.fn()
      .mockResolvedValueOnce(aiResponseForInitial)
      .mockResolvedValueOnce(aiResponseForRevision || aiResponseForInitial),
  };
  let savedLog = null;
  const foodLogStore = {
    save: jest.fn().mockImplementation(async (log) => { savedLog = log; }),
    findByUuid: jest.fn().mockImplementation(async () => savedLog),
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const conversationStateStore = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue({}),
    clear: jest.fn().mockResolvedValue({}),
  };
  const responseContext = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'ctx-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
    createStatusIndicator: jest.fn().mockResolvedValue({
      messageId: 'status-1',
      finish: jest.fn().mockResolvedValue({}),
    }),
  };
  return {
    messagingGateway, aiGateway, foodLogStore, conversationStateStore, responseContext,
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    config: {
      getDefaultTimezone: () => 'America/Los_Angeles',
      getUserTimezone: () => 'America/Los_Angeles',
    },
    encodeCallback: (cmd, data) => JSON.stringify({ cmd, ...data }),
    getSavedLog: () => savedLog,
  };
}

function aiJson(date, items = [{ name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 }]) {
  return JSON.stringify({ date, time: 'morning', items });
}

describe('Date bulletproofing — initial logging', () => {
  afterEach(() => resetClock());

  it('uses AI-inferred date when user says "yesterday I ate" on Thursday', async () => {
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(aiJson('2026-04-15'));
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'yesterday I ate peas', messageId: 'm1',
      responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-15');
  });

  it('falls back to today (entry date) when AI omits date field', async () => {
    mockClock(THU_NOON_PT);
    const aiNoDate = JSON.stringify({
      items: [{ name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 }],
    });
    const deps = buildTextDeps(aiNoDate);
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1',
      responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16'); // entry day
  });
});

describe('Date bulletproofing — accept', () => {
  afterEach(() => resetClock());

  it('preserves original meal.date when accepted same day', async () => {
    mockClock(THU_NOON_PT);
    // Mock adjustment: plan text had items: [], but AcceptFoodLog's
    // saveMany branch short-circuits when items.length === 0, making the
    // assertion vacuous. Add one item so the bug under test is exercised.
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    const deps = buildAcceptDeps(log);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: log.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']);
  });

  it('preserves original meal.date when accepted next day', async () => {
    // Log created Thu, accepted Fri
    mockClock(THU_NOON_PT);
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    const deps = buildAcceptDeps(log);
    mockClock(FRI_NOON_PT);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: log.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']); // NOT 2026-04-17
  });

  it('derives date from createdAt when meal.date is missing (legacy log)', async () => {
    // Simulate legacy log without meal.date but with a valid createdAt (Thu).
    // NutriLog instances are frozen with private fields, so spreading them
    // yields nothing useful — we build a plain-object double that has the
    // exact shape AcceptFoodLog reads from (status, items, meal, createdAt).
    mockClock(THU_NOON_PT);
    const realLog = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    const brokenJson = { ...realLog.toJSON(), meal: { time: 'afternoon' } };
    const brokenLog = {
      id: realLog.id,
      userId: realLog.userId,
      status: 'pending',
      text: realLog.text,
      items: realLog.items, // array of FoodItem instances — AcceptFoodLog spreads/toJSONs them
      meal: { time: 'afternoon' }, // no date
      metadata: realLog.metadata,
      createdAt: realLog.createdAt, // still Thu
      toJSON: () => brokenJson,
    };
    const deps = buildAcceptDeps(brokenLog);
    mockClock(FRI_NOON_PT);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: realLog.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']); // derived from createdAt, NOT 2026-04-17
  });
});

describe('Date bulletproofing — revision', () => {
  afterEach(() => resetClock());

  it('revision on next day with no date words preserves original date', async () => {
    // Log created Thu, revised Fri with "add a banana" (no date mention)
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(
      aiJson('2026-04-16'), // initial
      aiJson('2026-04-16', [ // revision — AI correctly defaults to pinned "today" = Thu
        { name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 },
        { name: 'Banana', noom_color: 'yellow', quantity: 1, unit: 'g', grams: 100, calories: 90, protein: 1, carbs: 23, fat: 0 },
      ]),
    );
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1', responseContext: deps.responseContext });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16');

    // Now revise on Friday
    mockClock(FRI_NOON_PT);
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { pendingLogUuid: deps.getSavedLog().id, originalMessageId: 'orig' },
    });
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'add a banana', messageId: 'm2', responseContext: deps.responseContext });

    // AFTER FIX: date should still be Thursday
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16');

    // Verify the revision prompt pinned "today" to original createdAt (Thu)
    const revisionCall = deps.aiGateway.chat.mock.calls[1];
    const systemPrompt = revisionCall[0].find(m => m.role === 'system').content;
    expect(systemPrompt).toContain('2026-04-16'); // the pinned date
  });

  it('revision with explicit "yesterday" relative to ORIGINAL date moves correctly', async () => {
    // Log created Thu as Thu, then revised saying "actually that was yesterday"
    // → should become Wed (Thu - 1), not "yesterday-from-Fri" (= Thu, same as before)
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(
      aiJson('2026-04-16'),
      aiJson('2026-04-15'), // AI correctly subtracts 1 from pinned Thu
    );
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1', responseContext: deps.responseContext });

    mockClock(FRI_NOON_PT);
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { pendingLogUuid: deps.getSavedLog().id, originalMessageId: 'orig' },
    });
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'actually that was yesterday', messageId: 'm2', responseContext: deps.responseContext });

    expect(deps.getSavedLog().meal.date).toBe('2026-04-15'); // Wed
  });
});

// buildAcceptDeps helper
function buildAcceptDeps(nutriLog) {
  const savedItemDates = [];
  return {
    savedItemDates,
    messagingGateway: {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'm' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    },
    foodLogStore: {
      findByUuid: jest.fn().mockResolvedValue(nutriLog),
      updateStatus: jest.fn().mockResolvedValue({}),
      findPending: jest.fn().mockResolvedValue([]),
    },
    nutriListStore: {
      saveMany: jest.fn().mockImplementation(async (items) => {
        for (const it of items) savedItemDates.push(it.date);
      }),
    },
    conversationStateStore: { clear: jest.fn().mockResolvedValue({}) },
    generateDailyReport: { execute: jest.fn().mockResolvedValue({}) },
    config: { getDefaultTimezone: () => 'America/Los_Angeles' },
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('NutriLog.updateDate', () => {
  it('updates meal.date and does not leak a top-level date field', () => {
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: new Date('2026-04-16T19:00:00Z'),
    });
    const updated = log.updateDate('2026-04-15', 'evening', new Date('2026-04-16T20:00:00Z'));
    const json = updated.toJSON();
    expect(json.meal.date).toBe('2026-04-15');
    expect(json.meal.time).toBe('evening');
    expect(json.date).toBeUndefined(); // no stray top-level date
  });
});
