/**
 * Nutribot's quick-input routes against the real path: router, shared
 * quick-input route and intake, Nutribot's kind handlers, NutribotInputRouter
 * and the three capture use cases with the accept path. Only the edges are
 * fakes: the messaging gateway (Telegram + transcription), the AI gateway and
 * the stores. Nothing here opens a connection off this host.
 *
 * The app under test has no app-wide body parser or CORS handler, as the
 * real app has none on these paths (app.mjs `exceptPaths`).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createNutribotRouter } from './nutribot.mjs';
import { NutribotInputRouter } from '../../application/services/NutribotInputRouter.mjs';
import { createNutribotQuickInputs } from '../../application/services/nutribotQuickInputs.mjs';
import { NutribotDirectInput } from '../../application/services/NutribotDirectInput.mjs';
import { LogFoodFromText } from '../../application/usecases/LogFoodFromText.mjs';
import { LogFoodFromVoice } from '../../application/usecases/LogFoodFromVoice.mjs';
import { LogFoodFromImage } from '../../application/usecases/LogFoodFromImage.mjs';
import { AcceptFoodLog } from '../../application/usecases/AcceptFoodLog.mjs';

const CHAT = 'telegram:b9_c2';
const NOTE = 'Two scrambled eggs and a slice of sourdough toast.';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a plate, in bytes '.repeat(8))]);
const ITEMS = [
  { name: 'Eggs', icon: 'egg', quantity: 2, grams: 100, calories: 150 },
  { name: 'Toast', icon: 'bread', quantity: 1, grams: 40, calories: 110 },
];
const nullLogger = { debug() {}, info() {}, warn() {}, error() {} };

function capturingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

function build({ items = ITEMS, transcript = NOTE, aiFails = 0, limits, logger = nullLogger, aiAvailable = true,
  devices = { phone: { quick_input: { nutribot: ['user_1', 'stranger'] } } } } = {}) {
  const ledgerFiles = new Map();
  const logs = new Map();
  const foodLogStore = {
    logs,
    save: async (log) => { logs.set(log.id, log); return log; },
    findByUuid: async (id) => logs.get(id) || null,
    updateStatus: async (userId, id, status) => {
      const updated = logs.get(id).with({ status }, new Date());
      logs.set(id, updated);
      return updated;
    },
    findPending: async () => [],
  };
  const nutriListStore = { saveMany: async () => {}, removeByLogId: async () => 0 };
  const telegram = { messages: [], photos: [], transcribed: [], updates: [] };
  const ai = { text: 0, image: 0, failures: aiFails };
  const messagingGateway = {
    sendMessage: async (chatId, text) => { telegram.messages.push({ chatId, text }); return { messageId: `m${telegram.messages.length}` }; },
    sendPhoto: async (chatId, source, caption) => { telegram.photos.push({ chatId, source, caption }); return { messageId: `p${telegram.photos.length}` }; },
    updateMessage: async (chatId, messageId, update) => { telegram.updates.push({ chatId, messageId, update }); },
    deleteMessage: async () => {},
    transcribeVoice: async (file) => { telegram.transcribed.push(file); return transcript; },
  };
  const answer = () => {
    if (ai.failures > 0) { ai.failures -= 1; throw new Error('model is down'); }
    return JSON.stringify({ items });
  };
  const aiGateway = {
    chat: async () => { ai.text += 1; return answer(); },
    chatWithImage: async (prompt, image) => { ai.image += 1; ai.lastImage = image; return answer(); },
  };
  const logFoodFromText = new LogFoodFromText({ messagingGateway, aiGateway, foodLogStore, logger });
  const logFoodFromVoice = new LogFoodFromVoice({ messagingGateway, logFoodFromText, logger });
  const logFoodFromImage = new LogFoodFromImage({
    messagingGateway, aiGateway, foodLogStore, logger,
    imageDownloader: { download: async () => { throw new Error('a buffer is not downloaded'); } },
  });
  const acceptFoodLog = new AcceptFoodLog({
    messagingGateway, foodLogStore, nutriListStore, logger,
    generateDailyReport: { execute: async () => ({ success: true }) },
  });
  const receipts = { refresh: vi.fn(async () => {}) };
  const container = {
    getConversationStateStore: () => null,
    getFoodLogStore: () => foodLogStore,
    getNutriListStore: () => nutriListStore,
    getMessagingGateway: () => messagingGateway,
    getReceiptPublisher: () => receipts,
    getMealCoachingTrigger: () => null,
    getAcceptFoodLog: () => acceptFoodLog,
    getLogFoodFromText: () => logFoodFromText,
    getLogFoodFromVoice: () => logFoodFromVoice,
    getLogFoodFromImage: () => logFoodFromImage,
  };
  const inputRouter = new NutribotInputRouter(container, { logger, aiGatewayAvailable: aiAvailable });
  const quick = createNutribotQuickInputs({
    available: aiAvailable,
    inputRouter,
    ledgerStore: {
      read: (username) => (ledgerFiles.has(username) ? structuredClone(ledgerFiles.get(username)) : null),
      write: (username, data) => { ledgerFiles.set(username, structuredClone(data)); return true; },
    },
    limits,
    timezone: () => 'America/Los_Angeles',
    deviceConfig: (deviceKey) => devices[deviceKey],
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error(`Cannot resolve Telegram ID for username "${username}"`);
      return CHAT;
    },
    logger,
  });

  // The routes Nutribot had before, as a caller with no device header reaches them.
  const legacy = { text: [], image: [] };
  const nutribotApi = {
    userContext: (user) => ({ userId: user || 'user_1', conversationId: CHAT }),
    logText: async (commandIn) => { legacy.text.push(commandIn); return { success: true }; },
    logImage: async (commandIn) => { legacy.image.push(commandIn); return { success: true }; },
    logUpc: async () => ({ success: true }),
    report: async () => ({}),
  };
  const directInput = new NutribotDirectInput({
    ledger: quick.ledger,
    deviceConfig: (deviceKey) => devices[deviceKey],
    resolveIdentity: (username) => ({ username, conversationIdString: CHAT }),
    operations: { upc: nutribotApi.logUpc, image: nutribotApi.logImage, text: nutribotApi.logText },
    logger,
  });
  const app = express();
  app.use('/api/v1/nutribot', createNutribotRouter(nutribotApi, { logger, quickInput: quick.endpoints, directInput }));
  return { app, telegram, ai, logs, legacy, receipts };
}

const TYPES = { voice: 'audio/ogg', text: 'text/plain; charset=utf-8', photo: 'image/jpeg' };
const BODIES = { voice: Buffer.from('opus bytes'), text: NOTE, photo: JPEG };
const send = (app, kind, { id = '1700000000000-0a1b2c3d', user = 'user_1', recordedAt = null, device = 'fleet:phone', type = TYPES[kind], body = BODIES[kind] } = {}) => request(app)
  .post(`/api/v1/nutribot/${kind}`).query({ user })
  .set(device ? { 'X-Daylight-Device': device } : {})
  .set('X-Daylight-Input-Id', id).set(recordedAt ? { 'X-Daylight-Recorded-At': String(recordedAt) } : {})
  .set('Content-Type', type).send(body);

const only = (logs) => { expect(logs.size).toBe(1); return [...logs.values()][0]; };

describe('POST /api/v1/nutribot/text', () => {
  it('logs a typed meal once and replies in the user\'s conversation', async () => {
    const { app, telegram, ai, logs, receipts } = build();
    const res = await send(app, 'text');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: false, receiptDelivery: 'uncertain' });

    const log = only(logs);
    expect(log.status).toBe('accepted');
    expect(log.metadata.source).toBe('text');
    expect(log.items.map((item) => item.label)).toEqual(['Eggs', 'Toast']);
    expect(ai.text).toBe(1);
    expect(telegram.messages.length).toBeGreaterThan(0);
    expect(new Set(telegram.messages.map((m) => m.chatId))).toEqual(new Set([CHAT]));
    expect(receipts.refresh).toHaveBeenCalledWith('user_1', log.id);

    const again = await send(app, 'text');
    expect(again.body).toEqual({ ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: true, receiptDelivery: 'uncertain' });
    expect(logs.size).toBe(1);
    expect(ai.text).toBe(1);
  });

  it('answers 422 for a note with no food in it, and does not ask the model again on a retry', async () => {
    const { app, ai, logs } = build({ items: [] });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await send(app, 'text');
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ ok: false, error: 'unusable_input', inputId: '1700000000000-0a1b2c3d' });
    }
    expect(ai.text).toBe(1);
    expect(logs.size).toBe(0);
  });

  it('answers 500 when the model fails, and the retry logs the meal once', async () => {
    const { app, logs } = build({ aiFails: 1 });
    const failed = await send(app, 'text');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ ok: false, error: 'processing_failed', inputId: '1700000000000-0a1b2c3d' });
    expect((await send(app, 'text')).body.duplicate).toBe(false);
    expect(logs.size).toBe(1);
  });

  it('leaves a JSON or form body to the earlier /text, behind that route\'s own guard', async () => {
    const { app, legacy, logs } = build();
    // No device: the earlier shape is refused too.
    const bare = await request(app).post('/api/v1/nutribot/text').send({ text: 'an apple', user: 'user_1' });
    expect(bare.status).toBe(403);
    // A bound device may use it; the meal goes to the earlier handler, not the quick-input path.
    const json = await request(app).post('/api/v1/nutribot/text').set('X-Daylight-Device', 'fleet:phone')
      .set('X-Daylight-Input-Id', 'i1').send({ text: 'an apple', user: 'user_1' });
    expect(json.status).toBe(200);
    expect(json.body.result).toEqual({ success: true });
    expect(legacy.text.map((c) => c.text)).toEqual(['an apple']);
    expect(logs.size).toBe(0);
  });

  it('holds any other body that names a device to the quick-input rules', async () => {
    const { app, legacy } = build();
    const res = await request(app).post('/api/v1/nutribot/text').query({ user: 'user_1' })
      .set('X-Daylight-Device', 'fleet:phone').set('X-Daylight-Input-Id', 'i1')
      .set('Content-Type', 'audio/ogg').send(Buffer.from('opus'));
    expect(res.status).toBe(415);
    expect(legacy.text).toHaveLength(0);
  });
});

describe('POST /api/v1/nutribot/voice', () => {
  it('transcribes the recording from its bytes and logs the meal', async () => {
    const { app, telegram, logs } = build();
    const res = await send(app, 'voice');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: false, receiptDelivery: 'uncertain' });
    expect(telegram.transcribed).toHaveLength(1);
    expect(Buffer.isBuffer(telegram.transcribed[0].buffer)).toBe(true);
    expect(telegram.transcribed[0].mimeType).toBe('audio/ogg');
    expect(only(logs).status).toBe('accepted');

    expect((await send(app, 'voice')).body.duplicate).toBe(true);
    expect(telegram.transcribed).toHaveLength(1);
  });

  it('answers 422 empty_transcription for a recording with no words, once transcribed', async () => {
    const { app, telegram, logs } = build({ transcript: '  ' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await send(app, 'voice');
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('empty_transcription');
    }
    expect(telegram.transcribed).toHaveLength(1);
    expect(logs.size).toBe(0);
  });
});

describe('POST /api/v1/nutribot/photo', () => {
  it('sends the photo to the chat and the model as bytes and logs the meal', async () => {
    const { app, telegram, ai, logs } = build();
    const res = await send(app, 'photo');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: false, receiptDelivery: 'uncertain' });
    expect(telegram.photos).toHaveLength(1);
    expect(telegram.photos[0].chatId).toBe(CHAT);
    expect(telegram.photos[0].source.equals(JPEG)).toBe(true);
    expect(ai.lastImage.equals(JPEG)).toBe(true);
    const log = only(logs);
    expect(log.metadata.source).toBe('image');
    expect(log.status).toBe('accepted');

    expect((await send(app, 'photo')).body.duplicate).toBe(true);
    expect(ai.image).toBe(1);
    expect(telegram.photos).toHaveLength(1);
  });

  it('answers 422 unusable_input for a photo with no food in it, and does not pay for it twice', async () => {
    const { app, ai } = build({ items: [] });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await send(app, 'photo');
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ ok: false, error: 'unusable_input', inputId: '1700000000000-0a1b2c3d' });
    }
    expect(ai.image).toBe(1);
  });

  it('answers 422 for bytes that are not an image, with no model asked and nothing sent', async () => {
    const { app, ai, telegram } = build();
    const res = await send(app, 'photo', { body: Buffer.from('this is not a jpeg') });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unusable_input');
    expect(ai.image).toBe(0);
    expect(telegram.photos).toHaveLength(0);
  });

  it('files a meal photographed at lunch two days ago under that day\'s lunch', async () => {
    const { app, logs } = build();
    // 12:30 in Los Angeles, two days before now.
    const now = new Date();
    const localNoon = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const date = localNoon.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const lunch = new Date(`${date}T12:30:00-08:00`).getTime();
    const res = await send(app, 'photo', { recordedAt: lunch });
    expect(res.status).toBe(200);
    const log = only(logs);
    expect(log.meal.date).toBe(date);
    expect(log.meal.time).toBe('afternoon');
  });
});

describe('every Nutribot quick-input route', () => {
  it('refuses the way the contract says, before a model is asked', async () => {
    const { app, ai, telegram, logs } = build();
    for (const kind of ['voice', 'text', 'photo']) {
      expect((await send(app, kind, { device: null })).body.error).toBe('device_not_allowed');
      expect((await send(app, kind, { device: 'fleet:kitchen-tablet' })).status).toBe(403);
      expect((await send(app, kind, { user: 'stranger' })).body.error).toBe('unknown_user');
      expect((await send(app, kind, { id: 'bad id' })).body.error).toBe('invalid_input_id');
      // On /text a JSON body is the earlier shape of that route, so another type stands in for it.
      const wrongType = kind === 'text' ? 'text/html' : 'application/json';
      expect((await send(app, kind, { type: wrongType, body: '{}' })).status).toBe(415);
      expect((await send(app, kind).set('Origin', 'https://elsewhere.example')).body.error).toBe('cross_origin');
      const preflight = await request(app).options(`/api/v1/nutribot/${kind}`)
        .set('Origin', 'https://elsewhere.example').set('Access-Control-Request-Method', 'POST');
      expect(preflight.status).toBe(403);
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(ai.text + ai.image).toBe(0);
    expect(telegram.transcribed).toHaveLength(0);
    expect(logs.size).toBe(0);
  });

  it('is bound per bot: a device bound for the Journalist only may not send to Nutribot', async () => {
    const { app } = build({ devices: { phone: { quick_input: { journalist: ['user_1'] }, voice_memo: { users: ['user_1'] } } } });
    for (const kind of ['voice', 'text', 'photo']) {
      expect((await send(app, kind)).body.error).toBe('device_not_allowed');
    }
  });

  it('shares one daily allowance across the three kinds', async () => {
    const { app } = build({ limits: { inputs: 2 } });
    expect((await send(app, 'text', { id: 'one' })).status).toBe(200);
    expect((await send(app, 'photo', { id: 'two' })).status).toBe(200);
    const refused = await send(app, 'voice', { id: 'three' });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ ok: false, error: 'daily_limit', limit: 'inputs' });
    expect(refused.headers['retry-after']).toBe(String(refused.body.retryAfterSeconds));
  });

  it('is unavailable without the AI gateway', async () => {
    const { app } = build({ aiAvailable: false });
    for (const kind of ['voice', 'text', 'photo']) {
      const res = await send(app, kind);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('unavailable');
    }
  });

  it('logs nothing that was typed, said or photographed, anywhere on the way through', async () => {
    const logger = capturingLogger();
    const { app } = build({ logger });
    for (const kind of ['voice', 'text', 'photo']) {
      expect((await send(app, kind, { id: `id-${kind}` })).status).toBe(200);
    }
    expect(logger.events.some((e) => e.event === 'quick_input.accepted' && e.data.bot === 'nutribot')).toBe(true);
    const secrets = [NOTE, JPEG.toString('latin1'), JPEG.toString('base64'), 'opus bytes'];
    const walk = (value, event) => {
      if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) throw new Error(`${event} carries binary data`);
      if (typeof value === 'string') {
        for (const secret of secrets) {
          for (let i = 0; i + 10 <= secret.length; i += 1) {
            if (value.includes(secret.slice(i, i + 10))) throw new Error(`${event} repeats captured content`);
          }
        }
      } else if (value && typeof value === 'object') Object.values(value).forEach((inner) => walk(inner, event));
    };
    logger.events.forEach((e) => walk(e.data, e.event));
  });
});
