/**
 * The Journalist's quick-input routes against the real path: router, shared
 * quick-input route and intake, the Journalist's kind handlers,
 * ProcessVoiceEntry, ProcessTextEntry and the YAML journal repository. Only
 * the edges are fakes: the messaging gateway (Telegram + transcription), the
 * AI gateway and the data service. Nothing here opens a connection off this host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createJournalistRouter } from './journalist.mjs';
import { JournalistApiService } from '../application/JournalistApiService.mjs';
import { JournalistContainer } from '../application/JournalistContainer.mjs';
import { createJournalQuickInputs } from '../application/services/journalQuickInputs.mjs';
import { YamlJournalEntryRepository } from '../adapters/persistence/YamlJournalEntryRepository.mjs';
import { YamlMemoLedgerStore } from '../adapters/persistence/YamlMemoLedgerStore.mjs';

const CHAT = 'telegram:b1_c2';
const TRANSCRIPT = 'Bought the tickets today.';
const NOTE = 'Called the plumber about the upstairs tap.';
const nullLogger = { debug() {}, info() {}, warn() {}, error() {} };

function capturingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

function build({ failReplies = 0, files = new Map(), limits, logger = nullLogger, aiAvailable = true,
  devices = { phone: { quick_input: { journalist: ['user_1', 'stranger'] } } } } = {}) {
  const dataService = {
    user: {
      read: (relativePath, username) => files.get(`${username}/${relativePath}`) ?? null,
      write: (relativePath, data, username) => { files.set(`${username}/${relativePath}`, structuredClone(data)); return true; },
    },
  };
  const telegram = { transcribed: [], sent: [], repliesToFail: failReplies, aiCalls: 0 };
  const messagingGateway = {
    transcribeVoice: async (file) => { telegram.transcribed.push(file); return TRANSCRIPT; },
    sendMessage: async (chatId, text, options = {}) => {
      if (options.choices && telegram.repliesToFail > 0) { telegram.repliesToFail -= 1; throw new Error('telegram is down'); }
      telegram.sent.push({ chatId, text });
      return { messageId: `sent-${telegram.sent.length}` };
    },
  };
  const aiGateway = {
    chat: async (prompt, options) => {
      telegram.aiCalls += 1;
      return options?.maxTokens === 150 ? '{"acknowledgment":"Noted.","question":"When are they coming?"}' : '["Tomorrow","Next week"]';
    },
  };
  const journal = new YamlJournalEntryRepository({ dataService, userResolver: { resolveUser: () => 'user_1' }, logger });
  const container = new JournalistContainer({ username: 'user_1' }, {
    messagingGateway, aiGateway, journalEntryRepository: journal, logger,
  });
  const resolveConversationId = (username) => {
    if (username !== 'user_1') throw new Error(`Cannot resolve Telegram ID for username "${username}"`);
    return CHAT;
  };
  const quick = createJournalQuickInputs({
    available: aiAvailable,
    processVoiceEntry: container.getProcessVoiceEntry(),
    processTextEntry: container.getProcessTextEntry(),
    journalEntryRepository: journal,
    ledgerStore: new YamlMemoLedgerStore({ dataService, logger }),
    limits,
    deviceConfig: (deviceKey) => devices[deviceKey],
    resolveConversationId,
    logger,
  });
  const journalistApi = new JournalistApiService({
    initiatePrompt: {}, generateMorningDebrief: {}, sendMorningDebrief: {},
    submitVoiceMemo: quick.submitVoiceMemo,
    memoDeviceUsers: quick.memoDeviceUsers,
    resolveConversationId,
    logger,
  });
  const app = express();
  app.use('/api/v1/journalist', createJournalistRouter(journalistApi, { logger, quickInput: quick.endpoints }));

  const entries = (prefix) => (files.get('user_1/lifelog/journalist/messages')?.messages || [])
    .filter((m) => String(m.id).startsWith(prefix));
  return { app, telegram, entries, journal, files };
}

const send = (app, route, { id = '1700000000000-0a1b2c3d', user = 'user_1', recordedAt = null, device = 'fleet:phone', idHeader = 'X-Daylight-Input-Id', type, body } = {}) => request(app)
  .post(`/api/v1/journalist/${route}`).query({ user })
  .set(device ? { 'X-Daylight-Device': device } : {})
  .set(idHeader, id).set(recordedAt ? { 'X-Daylight-Recorded-At': String(recordedAt) } : {})
  .set('Content-Type', type ?? (route === 'text' ? 'text/plain; charset=utf-8' : 'audio/ogg'))
  .send(body ?? (route === 'text' ? NOTE : Buffer.from('opus bytes')));

// ---- /voice: the canonical name of the memo intake ----

test('/voice does what /memo does and answers with the id under both names', async () => {
  const { app, telegram, entries } = build();
  const res = await send(app, 'voice');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true, inputId: '1700000000000-0a1b2c3d', memoId: '1700000000000-0a1b2c3d',
    duplicate: false, transcriptionLength: TRANSCRIPT.length,
  });
  assert.equal(telegram.transcribed[0].mimeType, 'audio/ogg');
  assert.deepEqual(entries('memo:').map((m) => m.content), [TRANSCRIPT]);
  assert.equal(telegram.sent.length, 2);
});

test('/voice and /memo are one intake: an id sent to one is a duplicate on the other', async () => {
  const { app, telegram, entries } = build();
  assert.equal((await send(app, 'memo', { idHeader: 'X-Daylight-Memo-Id' })).body.duplicate, false);
  const again = await send(app, 'voice');
  assert.deepEqual(again.body, { ok: true, inputId: '1700000000000-0a1b2c3d', memoId: '1700000000000-0a1b2c3d', duplicate: true });
  const third = await send(app, 'memo', { idHeader: 'X-Daylight-Input-Id' });
  assert.deepEqual(third.body, { ok: true, memoId: '1700000000000-0a1b2c3d', duplicate: true });
  assert.equal(telegram.transcribed.length, 1);
  assert.equal(entries('memo:').length, 1);
});

test('/voice names a bad id invalid_input_id; /memo still names it invalid_memo_id', async () => {
  const { app } = build();
  assert.equal((await send(app, 'voice', { id: 'bad id' })).body.error, 'invalid_input_id');
  assert.equal((await send(app, 'memo', { id: 'bad id' })).body.error, 'invalid_memo_id');
});

// ---- /text ----

test('a typed note is journaled and answered with the follow-up question, with no echo', async () => {
  const { app, telegram, entries } = build();
  const res = await send(app, 'text');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: false });

  const [entry] = entries('note:');
  assert.equal(entry.id, 'note:1700000000000-0a1b2c3d');
  assert.equal(entry.content, NOTE);
  assert.equal(telegram.transcribed.length, 0);
  assert.deepEqual(telegram.sent.map((m) => m.chatId), [CHAT]);
  assert.match(telegram.sent[0].text, /When are they coming\?/);
});

test('sending the same note twice leaves one entry and one reply', async () => {
  const { app, telegram, entries } = build();
  await send(app, 'text');
  const again = await send(app, 'text');
  assert.deepEqual(again.body, { ok: true, inputId: '1700000000000-0a1b2c3d', duplicate: true });
  assert.equal(entries('note:').length, 1);
  assert.equal(telegram.sent.length, 1);
});

test('a note and a recording with the same id are two inputs', async () => {
  const { app, entries } = build();
  assert.equal((await send(app, 'text')).body.duplicate, false);
  assert.equal((await send(app, 'voice')).body.duplicate, false);
  assert.equal(entries('note:').length, 1);
  assert.equal(entries('memo:').length, 1);
});

test('a retry after the follow-up failed sends it once and does not journal the note again', async () => {
  const { app, telegram, entries } = build({ failReplies: 1 });
  assert.equal((await send(app, 'text')).status, 500);
  assert.equal(entries('note:').length, 1);
  assert.equal(telegram.sent.length, 0);

  const retry = await send(app, 'text');
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(entries('note:').length, 1);
  assert.equal(telegram.sent.length, 1);
  assert.equal((await send(app, 'text')).body.duplicate, true);
  assert.equal(telegram.sent.length, 1);
});

test('a note typed two days ago lands on the day it was typed', async () => {
  const { app, entries, journal } = build();
  const recordedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const recordedIso = new Date(recordedAt).toISOString();
  assert.equal((await send(app, 'text', { recordedAt })).status, 200);
  assert.equal(entries('note:')[0].timestamp, recordedIso);
  const thatDay = await journal.findByDate(CHAT, recordedIso.slice(0, 10));
  assert.deepEqual(thatDay.map((m) => m.id), ['note:1700000000000-0a1b2c3d']);
});

test('the note is trimmed, and a note of only spaces is refused', async () => {
  const { app, entries } = build();
  await send(app, 'text', { body: `  \n${NOTE}\n ` });
  assert.equal(entries('note:')[0].content, NOTE);
  const blank = await send(app, 'text', { id: 'blank', body: '   ' });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error, 'empty_body');
});

test('text is refused the way every quick input is', async () => {
  const { app, telegram, entries } = build();
  assert.equal((await send(app, 'text', { device: null })).body.error, 'device_not_allowed');
  assert.equal((await send(app, 'text', { device: 'fleet:kitchen-tablet' })).body.error, 'device_not_allowed');
  assert.equal((await send(app, 'text', { user: 'stranger' })).status, 404);
  assert.equal((await send(app, 'text', { type: 'application/json', body: '{"text":"x"}' })).status, 415);
  assert.equal((await send(app, 'text', { body: 'x'.repeat(16385) })).status, 413);
  assert.equal((await send(app, 'text').set('Origin', 'https://elsewhere.example')).body.error, 'cross_origin');
  const preflight = await request(app).options('/api/v1/journalist/text').set('Origin', 'https://elsewhere.example');
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  assert.equal(entries('note:').length, 0);
  assert.equal(telegram.aiCalls, 0);
});

test('notes and recordings share the Journalist\'s daily allowance', async () => {
  const { app } = build({ limits: { inputs: 2 } });
  assert.equal((await send(app, 'text', { id: 'one' })).status, 200);
  assert.equal((await send(app, 'voice', { id: 'two' })).status, 200);
  const refused = await send(app, 'text', { id: 'three' });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.limit, 'inputs');
  // The alias keeps its own word for the same limit.
  assert.equal((await send(app, 'memo', { id: 'four' })).body.limit, 'memos');
});

test('without the AI gateway both routes are unavailable', async () => {
  const { app } = build({ aiAvailable: false });
  for (const route of ['voice', 'text', 'memo']) {
    const res = await send(app, route);
    assert.equal(res.status, 503, route);
    assert.equal(res.body.error, 'unavailable');
  }
});

// ---- who may send ----

test('the device binding is per bot, and the earlier voice memo binding covers voice only', async () => {
  const earlier = build({ devices: { phone: { voice_memo: { users: ['user_1'] } } } });
  assert.equal((await send(earlier.app, 'voice')).status, 200);
  assert.equal((await send(earlier.app, 'memo', { id: 'm2' })).status, 200);
  assert.equal((await send(earlier.app, 'text')).body.error, 'device_not_allowed');

  const otherBot = build({ devices: { phone: { quick_input: { nutribot: ['user_1'] } } } });
  assert.equal((await send(otherBot.app, 'voice')).body.error, 'device_not_allowed');
  assert.equal((await send(otherBot.app, 'text')).body.error, 'device_not_allowed');
});

// ---- privacy ----

test('nothing typed reaches the log anywhere on the way through', async () => {
  const logger = capturingLogger();
  const { app } = build({ logger });
  assert.equal((await send(app, 'text')).status, 200);
  assert.ok(logger.events.some((e) => e.event === 'quick_input.accepted'));
  const walk = (value) => {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) assert.fail('an event carries binary data');
    if (typeof value === 'string') assert.ok(!value.includes(NOTE.slice(0, 13)), 'an event repeats the note');
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  logger.events.forEach((e) => walk(e.data));
});
