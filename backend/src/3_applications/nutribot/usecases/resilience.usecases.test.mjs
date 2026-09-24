/**
 * Use-case halves of the nutribot resilience work (2026-09-24).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LogFoodFromVoice } from './LogFoodFromVoice.mjs';
import { RetryImageDetection } from './RetryImageDetection.mjs';
import { RestoreFoodLog } from './RestoreFoodLog.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

// The real failure: raw axios 502 from Whisper.
const whisper502 = () => Object.assign(new Error('Request failed with status code 502'), { code: 'ERR_BAD_RESPONSE', response: { status: 502 } });

function voiceUseCase(transcribe) {
  const status = { messageId: '11721', finish: vi.fn(async () => '11721'), cancel: vi.fn(async () => {}) };
  const rc = { createStatusIndicator: vi.fn(async () => status), sendMessage: vi.fn(async () => ({ messageId: 'x' })), deleteMessage: vi.fn(async () => {}) };
  const gateway = { transcribeVoice: vi.fn(transcribe) };
  const logFoodFromText = { execute: vi.fn(async () => ({ success: true })) };
  const useCase = new LogFoodFromVoice({ messagingGateway: gateway, logFoodFromText, logger: silent });
  return { useCase, rc, status, logFoodFromText };
}

describe('LogFoodFromVoice', () => {
  it('a failed transcription shows 🔄 Retry and reports the message to hang the retry on', async () => {
    const { useCase, rc, status } = voiceUseCase(async () => { throw whisper502(); });
    const out = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', voiceData: { fileId: 'AwAC' }, responseContext: rc, offerRetry: true });
    expect(out).toMatchObject({ success: false, code: 'TRANSCRIBE_FAILED', retryMessageId: '11721' });
    const [text, options] = status.finish.mock.calls[0];
    expect(text).toMatch(/Retry/);
    expect(JSON.parse(options.choices[0][0].callback_data)).toEqual({ cmd: 'vr' });
  });

  it('without offerRetry (web) there is no button', async () => {
    const { useCase, rc, status } = voiceUseCase(async () => { throw whisper502(); });
    const out = await useCase.execute({ userId: 'kckern', conversationId: 'web:kckern', voiceData: { fileId: 'x' }, responseContext: rc });
    expect(out.retryMessageId).toBeNull();
    expect(status.finish.mock.calls[0][1]).toEqual({});
  });

  it('routes the transcript to an open flow instead of logging a new meal', async () => {
    const { useCase, rc, logFoodFromText } = voiceUseCase(async () => 'make the rice half');
    const routeTranscript = vi.fn(async () => ({ ok: true, revised: true }));
    const out = await useCase.execute({ userId: 'kckern', conversationId: 'telegram:b1_c2', voiceData: { fileId: 'AwAC' }, responseContext: rc, routeTranscript });
    expect(routeTranscript).toHaveBeenCalledWith('make the rice half');
    expect(logFoodFromText.execute).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, revised: true });
  });
});

describe('RetryImageDetection', () => {
  it("retries from the photo's own session and leaves an open revision alone", async () => {
    const sessions = { '11709': { activeFlow: 'image_retry', flowState: { imageData: { fileId: 'AgAC' }, retryMessageId: '11709' } } };
    const store = { get: vi.fn(async (id, m) => (m ? sessions[m] ?? null : { activeFlow: 'revision' })),
      set: vi.fn(async (id, v, m) => { sessions[m] = v; }), clear: vi.fn() };
    const logFoodFromImage = { execute: vi.fn(async () => ({ success: true })) };
    const uc = new RetryImageDetection({ conversationStateStore: store, logFoodFromImage, logger: silent });
    await uc.execute({ userId: 'kckern', conversationId: 'c', messageId: '11709', responseContext: { deleteMessage: vi.fn() } });
    expect(logFoodFromImage.execute.mock.calls[0][0].imageData.fileId).toBe('AgAC');
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe('RestoreFoodLog (real YAML ledger)', () => {
  it('brings every row of an undone log back and marks the log accepted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-log-'));
    const store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: silent });
    const rows = ['White Rice', 'Spinach'].map((item, i) => ({ uuid: randomUUID(), userId: 'kckern', item, calories: [242, 13][i], date: '2026-09-24', mealTime: 'afternoon', logId: 'gaEcGWCYfN', log_uuid: 'gaEcGWCYfN' }));
    await store.saveMany(rows);
    await store.removeByLogId('kckern', 'gaEcGWCYfN');
    expect(await store.findByDate('kckern', '2026-09-24')).toHaveLength(0);

    const log = { status: 'deleted', with: vi.fn(function (patch) { return { ...this, ...patch }; }) };
    const foodLogStore = { findByUuid: vi.fn(async () => log), save: vi.fn(async () => {}) };
    const refresh = vi.fn(async () => {});
    const uc = new RestoreFoodLog({ nutriListStore: store, foodLogStore, receipts: () => ({ refresh }), logger: silent });
    const out = await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'gaEcGWCYfN' });

    expect(out).toEqual({ restored: 2, dates: ['2026-09-24'] });
    expect((await store.findByDate('kckern', '2026-09-24')).map(r => r.item).sort()).toEqual(['Spinach', 'White Rice']);
    expect(foodLogStore.save.mock.calls[0][0].status).toBe('accepted');
    expect(refresh).toHaveBeenCalledWith('kckern', 'gaEcGWCYfN');
    // A second tap is harmless.
    expect((await uc.execute({ userId: 'kckern', conversationId: 'c', logUuid: 'gaEcGWCYfN', responseContext: { sendMessage: vi.fn() } })).restored).toBe(0);
  });
});
