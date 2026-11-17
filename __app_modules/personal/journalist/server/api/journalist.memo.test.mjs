/**
 * The memo route against the real voice path: router, service, SubmitVoiceMemo,
 * ProcessVoiceEntry, ProcessTextEntry and the YAML journal repository. Only the
 * edges are fakes: the messaging gateway (Telegram + transcription), the AI
 * gateway and the data service. Nothing here opens a connection off this host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createJournalistRouter } from './journalist.mjs';
import { JournalistApiService } from '../application/JournalistApiService.mjs';
import { JournalistContainer } from '../application/JournalistContainer.mjs';
import { SubmitVoiceMemo } from '../application/usecases/SubmitVoiceMemo.mjs';
import { MemoLedger } from '../application/services/MemoLedger.mjs';
import { YamlMemoLedgerStore } from '../adapters/persistence/YamlMemoLedgerStore.mjs';
import { YamlJournalEntryRepository } from '../adapters/persistence/YamlJournalEntryRepository.mjs';

const CHAT = 'telegram:b1_c2';
const TRANSCRIPT = 'Bought the tickets today.';
const nullLogger = { debug() {}, info() {}, warn() {}, error() {} };

function build({ transcript = TRANSCRIPT, failReplies = 0, failEchoes = 0 } = {}) {
  const files = new Map();
  const dataService = {
    user: {
      read: (relativePath, username) => files.get(`${username}/${relativePath}`) ?? null,
      write: (relativePath, data, username) => { files.set(`${username}/${relativePath}`, structuredClone(data)); return true; },
    },
  };
  const telegram = { transcribed: [], sent: [], repliesToFail: failReplies, echoesToFail: failEchoes };
  const messagingGateway = {
    transcribeVoice: async (file) => { telegram.transcribed.push(file); return transcript; },
    sendMessage: async (chatId, text, options = {}) => {
      // The transcript echo goes out with no choices; the follow-up carries them.
      if (options.choices && telegram.repliesToFail > 0) {
        telegram.repliesToFail -= 1;
        throw new Error('telegram is down');
      }
      if (!options.choices && telegram.echoesToFail > 0) {
        telegram.echoesToFail -= 1;
        throw new Error('telegram is down');
      }
      telegram.sent.push({ chatId, text });
      return { messageId: `sent-${telegram.sent.length}` };
    },
  };
  const aiGateway = {
    chat: async (prompt, options) => (options?.maxTokens === 150
      ? '{"acknowledgment":"Nice.","question":"Where to?"}'
      : '["Abroad","Nearby"]'),
  };
  const journal = new YamlJournalEntryRepository({
    dataService,
    userResolver: { resolveUser: () => 'user_1' },
    logger: nullLogger,
  });
  const container = new JournalistContainer({ username: 'user_1' }, {
    messagingGateway, aiGateway, journalEntryRepository: journal, logger: nullLogger,
  });
  const journalistApi = new JournalistApiService({
    initiatePrompt: {}, generateMorningDebrief: {}, sendMorningDebrief: {},
    submitVoiceMemo: new SubmitVoiceMemo({
      processVoiceEntry: container.getProcessVoiceEntry(),
      processTextEntry: container.getProcessTextEntry(),
      journalEntryRepository: journal,
      memoLedger: new MemoLedger({ store: new YamlMemoLedgerStore({ dataService, logger: nullLogger }) }),
      logger: nullLogger,
    }),
    principalResolver: { resolve: (explicit) => explicit || 'user_1' },
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error(`Cannot resolve Telegram ID for username "${username}"`);
      return CHAT;
    },
    logger: nullLogger,
  });
  const app = express();
  app.use('/api/v1/journalist', createJournalistRouter(journalistApi, { logger: nullLogger }));

  const userEntries = () => (files.get('user_1/lifelog/journalist/messages')?.messages || [])
    .filter((m) => String(m.id).startsWith('memo:'));
  return { app, telegram, userEntries, journal };
}

const upload = (app, { id = '1700000000000', user = 'user_1', recordedAt = null } = {}) => request(app)
  .post('/api/v1/journalist/memo').query({ user })
  .set('X-Daylight-Memo-Id', id).set(recordedAt ? { 'X-Daylight-Recorded-At': String(recordedAt) } : {}).set('Content-Type', 'audio/mp4')
  .send(Buffer.from('aac bytes'));

test('a memo is transcribed from its bytes, journaled, and answered in the conversation', async () => {
  const { app, telegram, userEntries } = build();
  const res = await upload(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, memoId: '1700000000000', duplicate: false, transcriptionLength: TRANSCRIPT.length });

  assert.equal(telegram.transcribed.length, 1);
  assert.ok(Buffer.isBuffer(telegram.transcribed[0].buffer));
  assert.equal(telegram.transcribed[0].mimeType, 'audio/mp4');

  const entries = userEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'memo:1700000000000');
  assert.equal(entries[0].content, TRANSCRIPT);

  // The transcript echo, then the follow-up question, both to the user's conversation.
  assert.deepEqual(telegram.sent.map((m) => m.chatId), [CHAT, CHAT]);
  assert.ok(telegram.sent[0].text.endsWith(TRANSCRIPT));
  assert.match(telegram.sent[1].text, /Where to\?/);
});

test('uploading the same memo twice leaves one journal entry and one reply', async () => {
  const { app, telegram, userEntries } = build();
  await upload(app);
  const again = await upload(app);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true, memoId: '1700000000000', duplicate: true });
  assert.equal(userEntries().length, 1);
  assert.equal(telegram.transcribed.length, 1);
  assert.equal(telegram.sent.length, 2);
});

test('a retry after the follow-up failed sends it once, without a second transcription or echo', async () => {
  const { app, telegram, userEntries } = build({ failReplies: 1 });
  const first = await upload(app);
  assert.equal(first.status, 500);
  assert.equal(userEntries().length, 1);
  assert.equal(telegram.sent.length, 1);

  const retry = await upload(app);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(userEntries().length, 1);
  assert.equal(telegram.transcribed.length, 1);
  assert.equal(telegram.sent.length, 2);
  assert.match(telegram.sent[1].text, /Where to\?/);

  const third = await upload(app);
  assert.equal(third.body.duplicate, true);
  assert.equal(telegram.sent.length, 2);
});

test('while the chat cannot be reached, retries cost one transcription in all', async () => {
  const { app, telegram, userEntries } = build({ failEchoes: 5 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await upload(app)).status, 500);
  }
  // The entry was journaled on the first attempt, before anything was sent.
  assert.equal(userEntries().length, 1);
  assert.equal(telegram.sent.length, 0);

  const done = await upload(app);
  assert.equal(done.status, 200);
  assert.equal(telegram.transcribed.length, 1);
  assert.equal(userEntries().length, 1);
  assert.equal(telegram.sent.length, 2);
});

test('two different memos are two entries', async () => {
  const { app, userEntries } = build();
  await upload(app, { id: '1700000000000' });
  await upload(app, { id: '1700000099999' });
  assert.equal(userEntries().length, 2);
});

test('silence is answered 422 and nothing is journaled', async () => {
  const { app, userEntries } = build({ transcript: '  ' });
  const res = await upload(app);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'empty_transcription');
  assert.equal(userEntries().length, 0);
});

test('a user the Journalist does not know is refused before any audio is read', async () => {
  const { app, telegram } = build();
  const res = await upload(app, { user: 'stranger' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'unknown_user');
  assert.equal(telegram.transcribed.length, 0);
});

test('a memo recorded two days ago lands on the day it was recorded', async () => {
  const { app, userEntries, journal } = build();
  const recordedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const recordedIso = new Date(recordedAt).toISOString();
  const res = await upload(app, { recordedAt });
  assert.equal(res.status, 200);

  const [entry] = userEntries();
  assert.equal(entry.timestamp, recordedIso);
  const thatDay = await journal.findByDate(CHAT, recordedIso.slice(0, 10));
  assert.deepEqual(thatDay.map((m) => m.id), ['memo:1700000000000']);
  const today = await journal.findByDate(CHAT, new Date().toISOString().slice(0, 10));
  assert.equal(today.some((m) => m.id === 'memo:1700000000000'), false);
});

test('a back-dated memo sits in time order among the entries already there', async () => {
  const { app, userEntries } = build();
  await upload(app, { id: 'today' });
  await upload(app, { id: 'earlier', recordedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 });
  // The file is kept newest first.
  assert.deepEqual(userEntries().map((m) => m.id), ['memo:today', 'memo:earlier']);
});

test('a memo with no recorded time is stamped when it is processed', async () => {
  const { app, userEntries } = build();
  const before = Date.now();
  await upload(app);
  const stamped = new Date(userEntries()[0].timestamp).getTime();
  assert.ok(stamped >= before && stamped <= Date.now());
});
