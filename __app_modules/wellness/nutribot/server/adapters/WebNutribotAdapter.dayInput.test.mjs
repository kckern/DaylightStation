import { describe, it, expect, vi } from 'vitest';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';

const AUDIO = 'data:audio/webm;base64,AAAA';
const setup = (overrides = {}) => {
  const inputRouter = { handleText: vi.fn(async () => ({ ok: true, committed: true, logId: 'log', items: [], result: { nutrilogUuid: 'log' } })) };
  const dayInstructions = { available: true, resume: vi.fn(async () => null), execute: vi.fn(async (_user, input) => input.captureFoods({ text: input.text, date: input.date, operationId: 'child' })) };
  const transcribeVoice = vi.fn(async () => 'heard words');
  const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { inputRouter, dayInstructions, transcribeVoice, logger, adapter: new WebNutribotAdapter({ inputRouter, dayInstructions, transcribeVoice, logger, ...overrides }) };
};

describe('WebNutribotAdapter day input', () => {
  it('transcribes voice, then captures plainly without the meal interpreter', async () => {
    const mealInstructions = { execute: vi.fn(), replay: vi.fn() };
    const { adapter, dayInstructions, inputRouter, transcribeVoice } = setup({ mealInstructions });
    const result = await adapter.processDayInput({ userId: 'u', type: 'voice', content: AUDIO, date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    expect(transcribeVoice).toHaveBeenCalled();
    expect(dayInstructions.execute.mock.calls[0][1]).toMatchObject({ text: 'heard words', date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    const { payload } = inputRouter.handleText.mock.calls[0][0];
    expect(payload).toMatchObject({ text: 'heard words', date: '2026-11-18', bucket: null, operationId: 'child' });
    expect(payload.plainCapture).toBe(true);
    expect(payload.interpretText).toBeUndefined();
    expect(mealInstructions.execute).not.toHaveBeenCalled();
    expect(mealInstructions.replay).not.toHaveBeenCalled();
    expect(result).toMatchObject({ committed: true, logId: 'log' });
  });

  it('uses typed words as they are, without transcribing', async () => {
    const { adapter, dayInstructions, transcribeVoice } = setup();
    await adapter.processDayInput({ userId: 'u', type: 'text', content: 'two eggs', date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(dayInstructions.execute.mock.calls[0][1].text).toBe('two eggs');
  });

  it('reports 503 when day input is unavailable', async () => {
    const adapter = new WebNutribotAdapter({ inputRouter: {}, logger: {} });
    await expect(adapter.processDayInput({ userId: 'u', type: 'text', content: 'x', date: '2026-11-18' })).rejects.toMatchObject({ status: 503, code: 'DAY_INPUT_UNAVAILABLE' });
  });

  it('replaces a failed capture with its own error, so a provider status stays inside', async () => {
    const { adapter, inputRouter, logger } = setup();
    inputRouter.handleText.mockRejectedValue(Object.assign(new Error('Provider said 429'), { status: 429, code: 'rate_limit_exceeded' }));
    const failure = await adapter.processDayInput({ userId: 'u', type: 'text', content: 'eggs', date: '2026-11-18', today: '2026-11-18', operationId: 'op' }).catch(error => error);
    expect(failure).toMatchObject({ status: 503, code: 'DAY_INPUT_UNAVAILABLE', message: 'Day input is unavailable right now' });
    expect(logger.warn).toHaveBeenCalledWith('web-nutribot.day_input.capture_failed', expect.objectContaining({ userId: 'u', error: 'Provider said 429' }));
  });

  it('keeps the saved recording reference when transcription fails', async () => {
    const voiceMemoStore = { save: vi.fn(async () => 'va_saved') };
    const { adapter, transcribeVoice, dayInstructions } = setup({ voiceMemoStore });
    transcribeVoice.mockRejectedValue(Object.assign(new Error('upstream'), { status: 500 }));
    await expect(adapter.processDayInput({ userId: 'u', type: 'voice', content: AUDIO, date: '2026-11-18', today: '2026-11-18', operationId: 'op' }))
      .rejects.toMatchObject({ status: 502, code: 'TRANSCRIBE_FAILED', audioRef: 'va_saved' });
    expect(dayInstructions.execute).not.toHaveBeenCalled();
  });

  const revisionHarness = async (extra = {}) => {
    const { NutribotInputRouter } = await import('../application/services/NutribotInputRouter.mjs');
    const { LogFoodFromText } = await import('../application/usecases/LogFoodFromText.mjs');
    const conversationStateStore = { get: vi.fn(async () => ({ activeFlow: 'revision', flowState: { pendingLogUuid: 'open-log' } })) };
    const chat = vi.fn(async () => '{"items":[]}');
    const messaging = { sendMessage: vi.fn(async () => ({ messageId: 'm' })), updateMessage: vi.fn(async () => ({})), deleteMessage: vi.fn(async () => ({})) };
    const text = new LogFoodFromText({ messagingGateway: messaging, aiGateway: { chat }, conversationStateStore, logger: {} });
    const inputRouter = new NutribotInputRouter({ getLogFoodFromText: () => text }, { logger: {} });
    return { chat, conversationStateStore, ...setup({ inputRouter, ...extra }) };
  };

  it('keeps a capture out of an open revision, even when no food is found', async () => {
    const { adapter, chat, conversationStateStore } = await revisionHarness();
    const result = await adapter.processDayInput({ userId: 'u', type: 'text', content: 'two eggs', date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    expect(chat).toHaveBeenCalled();
    expect(result).toMatchObject({ committed: false, outcome: 'no-food' });
    expect(conversationStateStore.get).not.toHaveBeenCalled();
  });

  it('leaves the revision fallback in place for a capture launched from a meal', async () => {
    const mealInstructions = { execute: vi.fn(async () => null), replay: vi.fn(async () => null) };
    const { adapter, chat, conversationStateStore } = await revisionHarness({ mealInstructions });
    await adapter.process({ userId: 'u', type: 'text', content: 'two eggs', date: '2026-11-18', bucket: 'evening', operationId: 'op' });
    expect(mealInstructions.execute).toHaveBeenCalled();
    expect(chat).toHaveBeenCalled();
    expect(conversationStateStore.get).toHaveBeenCalledTimes(1);
  });

  it('reports a capture failure that is not a provider failure as what it is', async () => {
    const { adapter, inputRouter } = setup();
    const invalid = new Error('Invalid NutriLog');
    inputRouter.handleText.mockRejectedValue(invalid);
    await expect(adapter.processDayInput({ userId: 'u', type: 'text', content: 'eggs', date: '2026-11-18', today: '2026-11-18', operationId: 'op' })).rejects.toBe(invalid);
  });

  it('treats a network failure as the provider being unavailable', async () => {
    const { adapter, inputRouter } = setup();
    inputRouter.handleText.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await expect(adapter.processDayInput({ userId: 'u', type: 'text', content: 'eggs', date: '2026-11-18', today: '2026-11-18', operationId: 'op' })).rejects.toMatchObject({ status: 503, code: 'DAY_INPUT_UNAVAILABLE' });
  });

  it('returns finished work before transcribing a voice retry', async () => {
    const { adapter, dayInstructions, transcribeVoice } = setup();
    dayInstructions.resume.mockResolvedValue({ committed: true, kind: 'added' });
    const input = { userId: 'u', type: 'voice', content: AUDIO, date: '2026-11-18', today: '2026-11-18', operationId: 'op' };
    expect(await adapter.processDayInput(input)).toEqual({ committed: true, kind: 'added' });
    expect(dayInstructions.resume).toHaveBeenCalledWith('u', { date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(dayInstructions.execute).not.toHaveBeenCalled();
  });

  it('stops an over-long transcript before capture and keeps the recording', async () => {
    const voiceMemoStore = { save: vi.fn(async () => 'va_long') };
    const { adapter, transcribeVoice, dayInstructions } = setup({ voiceMemoStore });
    transcribeVoice.mockResolvedValue('a'.repeat(2001));
    await expect(adapter.processDayInput({ userId: 'u', type: 'voice', content: AUDIO, date: '2026-11-18', today: '2026-11-18', operationId: 'op' })).rejects.toMatchObject({
      status: 422, code: 'DAY_INPUT_TOO_LONG', audioRef: 'va_long', message: 'That is too long to log at once. Try it in two parts.' });
    expect(dayInstructions.execute).not.toHaveBeenCalled();
  });

  it('retries a saved recording without writing a new one', async () => {
    const voiceMemoStore = { save: vi.fn(), read: vi.fn(async () => ({ buffer: Buffer.from('a'), mimeType: 'audio/webm' })) };
    const { adapter, transcribeVoice, dayInstructions } = setup({ voiceMemoStore });
    await adapter.processDayInput({ userId: 'u', type: 'voice', audioRef: 'va_saved', date: '2026-11-18', today: '2026-11-18', operationId: 'op' });
    expect(voiceMemoStore.read).toHaveBeenCalledWith('u', 'va_saved');
    expect(voiceMemoStore.save).not.toHaveBeenCalled();
    expect(transcribeVoice).toHaveBeenCalledWith(expect.objectContaining({ audioRef: 'va_saved', mimeType: 'audio/webm' }));
    expect(dayInstructions.execute.mock.calls[0][1].text).toBe('heard words');
  });

  it('says so when a saved recording is gone', async () => {
    const { adapter, transcribeVoice } = setup({ voiceMemoStore: { read: vi.fn(async () => null) } });
    await expect(adapter.processDayInput({ userId: 'u', type: 'voice', audioRef: 'va_gone', date: '2026-11-18', today: '2026-11-18', operationId: 'op' })).rejects.toMatchObject({ code: 'AUDIO_NOT_FOUND' });
    expect(transcribeVoice).not.toHaveBeenCalled();
  });

  it('logs food once through the real ledger, inside the route operation', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { YamlNutriListDatastore } = await import('../../../health/server/adapters/persistence/yaml/YamlNutriListDatastore.mjs');
    const { MealFoodCommands } = await import('../../../health/server/application/health/MealFoodCommands.mjs');
    const { DayInstructionService } = await import('../../../health/server/application/health/DayInstructionService.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-input-'));
    try {
      const store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: {} });
      const row = { uuid: 'eggs', logId: 'log1', name: 'Eggs', userId: 'u', date: '2026-11-18', mealTime: 'morning', calories: 140, grams: 100 };
      const handleText = vi.fn(async () => {
        await store.saveMany([row]);
        return { ok: true, committed: true, logId: 'log1', items: [row], mealTime: 'morning', result: { nutrilogUuid: 'log1' } };
      });
      const dayInstructions = new DayInstructionService({ nutritionItems: store, mealCommands: new MealFoodCommands({ nutritionItems: store }),
        reader: { available: true, assignMeals: async () => ({ eggs: 'evening' }) }, logger: {} });
      const adapter = new WebNutribotAdapter({ inputRouter: { handleText }, dayInstructions, logger: {} });
      const input = { userId: 'u', type: 'text', content: 'eggs at dinner', date: '2026-11-18', today: '2026-11-18', operationId: 'route-op', resolved: {} };
      const send = () => store.runOperation('u', 'route-op', { operation: 'day-input', type: 'text', content: input.content, date: input.date, resolved: {} }, () => adapter.processDayInput(input));
      const first = await send();
      expect(first).toMatchObject({ committed: true, outcome: 'committed', kind: 'added', logId: 'log1' });
      expect(first.undoToken).toMatch(/^meal-/);
      expect(await send()).toEqual(first);
      expect(handleText).toHaveBeenCalledTimes(1);
      expect((await store.findByDate('u', '2026-11-18')).map(item => [item.uuid, item.mealTime])).toEqual([['eggs', 'evening']]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
