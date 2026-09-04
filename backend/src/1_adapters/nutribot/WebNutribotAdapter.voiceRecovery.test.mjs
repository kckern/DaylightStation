/**
 * A transient transcription failure must cost a retry, not the recording.
 *
 * WHAT HAPPENED (2026-09-04, production). Someone recorded a voice memo. Three
 * Whisper attempts failed inside ~58s — ETIMEDOUT, then two socket hang-ups —
 * and the request came back as `HTTP 500: {"error":"socket hang up"}`. Nothing
 * was logged, nothing was transcribed, and the audio had only ever existed as
 * an in-memory Buffer, so there was nothing to retry: the person had to say it
 * all again.
 *
 * Three things had to become true, and each is pinned here:
 *   1. the bytes are on disk BEFORE transcription is attempted,
 *   2. a failure is a readable sentence that says the recording is safe,
 *   3. saving is best-effort and never blocks a transcription that could work.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';
import { NutribotInputRouter } from '#apps/nutribot/services/NutribotInputRouter.mjs';
import { LogFoodFromVoice } from '#apps/nutribot/usecases/LogFoodFromVoice.mjs';
import { VoiceMemoStore } from '#adapters/persistence/VoiceMemoStore.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
// A real (tiny) webm-flavoured data URL, the shape VoiceCapture's FileReader produces.
const DATA_URL = `data:audio/webm;codecs=opus;base64,${Buffer.from('opus-ish bytes').toString('base64')}`;

function makeHarness({ transcribeVoice, voiceMemoStore = 'real' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicerecovery-'));
  const store = voiceMemoStore === 'real'
    ? new VoiceMemoStore({ dataService: { user: { resolveDir: (rel, u) => path.join(dir, 'users', u, rel) } }, logger: silent })
    : voiceMemoStore;

  const logs = [];
  const logger = { debug() {}, info() {}, warn: (e, d) => logs.push(['warn', e, d]), error: (e, d) => logs.push(['error', e, d]) };

  // transcribeVoice is reached through the use case's OWN messagingGateway,
  // never through the response context — `#getMessaging` says so explicitly
  // ("ResponseContext never has transcribeVoice"). Wiring it anywhere else
  // makes the call fail with a TypeError instead of the network error under
  // test, which every assertion here would then pass on for the wrong reason.
  const logFoodFromVoice = new LogFoodFromVoice({
    messagingGateway: {
      sendMessage: async () => ({ messageId: 'm' }),
      updateMessage: async () => {},
      deleteMessage: async () => {},
      transcribeVoice,
    },
    logFoodFromText: { execute: async () => ({ success: true, nutrilogUuid: 'log-1' }) },
    logger,
  });

  const container = {
    getConversationStateStore: () => null,
    getFoodLogStore: () => null,
    getNutriListStore: () => ({ saveMany: async () => {} }),
    getMessagingGateway: () => ({ sendMessage: async () => ({ messageId: 'm' }) }),
    getLogFoodFromVoice: () => logFoodFromVoice,
    getLogFoodFromText: () => ({ execute: async () => ({ success: true }) }),
    getLogFoodFromImage: () => ({ execute: async () => ({ success: true }) }),
    getLogFoodFromUPC: () => ({ execute: async () => ({ success: true }) }),
  };
  const inputRouter = new NutribotInputRouter(container, { logger: silent });
  const adapter = new WebNutribotAdapter({ inputRouter, voiceMemoStore: store, logger: silent });
  return { adapter, dir, store, logs };
}

const audioDir = (dir) => path.join(dir, 'users', 'kc', 'lifelog/nutrition/audio');
const hangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

describe('web voice capture — the recording survives a failed transcription', () => {
  it('writes the bytes BEFORE transcribing, so a failure has something to retry', async () => {
    let filesAtTranscribeTime = null;
    const { adapter, dir } = makeHarness({
      transcribeVoice: async () => {
        filesAtTranscribeTime = fs.readdirSync(audioDir(dir));
        throw hangUp();
      },
    });

    await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });

    // The ordering is the whole point: the file existed when the network call
    // was made, not merely by the time the request finished.
    expect(filesAtTranscribeTime).toHaveLength(1);
    expect(filesAtTranscribeTime[0]).toMatch(/^va_[A-Za-z0-9]+\.webm$/);
    expect(fs.readFileSync(path.join(audioDir(dir), filesAtTranscribeTime[0])))
      .toEqual(Buffer.from('opus-ish bytes'));
  });

  it('answers with a sentence that says the recording is saved — never a 500 fragment', async () => {
    const { adapter } = makeHarness({ transcribeVoice: async () => { throw hangUp(); } });

    const res = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });

    expect(res.responseText).toMatch(/your recording is saved/i);
    expect(res.responseText).not.toMatch(/socket hang up|HTTP 500/i);
    // No choices — the Today view renders a choice-less message as its notice.
    expect(res.messages.flatMap((m) => (m.choices || []).flat())).toHaveLength(0);
    expect(res.transcribeFailed).toBe(true);
    expect(res.audioRef).toMatch(/^va_[A-Za-z0-9]+$/);
  });

  it('does not throw — the failure is a result, not an exception the route turns into a 500', async () => {
    const { adapter } = makeHarness({ transcribeVoice: async () => { throw hangUp(); } });
    await expect(adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' })).resolves.toBeTruthy();
  });

  it('with NO store configured it still transcribes, and does not claim a save it did not make', async () => {
    const { adapter } = makeHarness({ transcribeVoice: async () => { throw hangUp(); }, voiceMemoStore: null });
    const res = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    expect(res.responseText).toMatch(/couldn't reach the transcriber/i);
    expect(res.responseText).not.toMatch(/saved/i);
    expect(res.audioRef).toBeNull();
  });

  it('a store that throws must not stop a transcription that would have worked', async () => {
    const exploding = { save: async () => { throw new Error('disk full'); } };
    const transcribeVoice = vi.fn(async () => 'two eggs and toast');
    const { adapter } = makeHarness({ transcribeVoice, voiceMemoStore: exploding });

    const res = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });

    expect(transcribeVoice).toHaveBeenCalledTimes(1);
    expect(res.transcribeFailed).toBeUndefined();
  });

  it('a network cut is logged at warn — expected weather, not an incident', async () => {
    const { adapter, logs } = makeHarness({ transcribeVoice: async () => { throw hangUp(); } });
    await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    const row = logs.find(([, event]) => event === 'logVoice.transcribe.failed');
    expect(row[0]).toBe('warn');
    expect(row[2].transient).toBe(true);
    expect(row[2].code).toBe('ECONNRESET');
  });

  it('anything that is NOT a network cut is logged at ERROR — the friendly message must not hide a bug', async () => {
    const { adapter, logs } = makeHarness({
      transcribeVoice: async () => { throw new TypeError('x.y is not a function'); },
    });
    const res = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    const row = logs.find(([, event]) => event === 'logVoice.transcribe.failed');
    expect(row[0]).toBe('error');
    expect(row[2].transient).toBe(false);
    expect(row[2].error).toMatch(/not a function/);
    // The person still gets the same sentence — the distinction is for us.
    expect(res.responseText).toMatch(/your recording is saved/i);
  });

  it('the SAVED bytes can be transcribed again without re-recording — the point of saving them', async () => {
    const attempts = [];
    const { adapter } = makeHarness({
      transcribeVoice: async (fileId) => {
        attempts.push(fileId.buffer);
        if (attempts.length === 1) throw hangUp();
        return 'two eggs and toast';
      },
    });

    const first = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    expect(first.transcribeFailed).toBe(true);

    // The retry carries the REF, no audio payload at all.
    const second = await adapter.process({ type: 'voice', audioRef: first.audioRef, userId: 'kc' });

    expect(second.transcribeFailed).toBeUndefined();
    // Byte-for-byte the same recording the first attempt was given.
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  it('a retry over a ref the store cannot find is a coded refusal, not a crash', async () => {
    const { adapter } = makeHarness({ transcribeVoice: async () => 'unused' });
    await expect(adapter.process({ type: 'voice', audioRef: 'va_neverStored', userId: 'kc' }))
      .rejects.toMatchObject({ code: 'AUDIO_NOT_FOUND' });
  });

  it('a retry never re-decodes content, so a missing data URL is not an error', async () => {
    const { adapter, dir } = makeHarness({ transcribeVoice: async () => { throw hangUp(); } });
    const first = await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    await adapter.process({ type: 'voice', audioRef: first.audioRef, userId: 'kc' });
    // And it does not write a SECOND copy of the same recording.
    expect(fs.readdirSync(audioDir(dir))).toHaveLength(1);
  });

  it('a successful transcription still leaves the memo on disk', async () => {
    const { adapter, dir } = makeHarness({ transcribeVoice: async () => 'two eggs and toast' });
    await adapter.process({ type: 'voice', content: DATA_URL, userId: 'kc' });
    expect(fs.readdirSync(audioDir(dir))).toHaveLength(1);
  });
});
