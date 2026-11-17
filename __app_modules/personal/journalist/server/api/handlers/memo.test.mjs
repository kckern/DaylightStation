import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { journalistMemoRoute, MEMO_MAX_BYTES } from './memo.mjs';

const AUDIO = Buffer.from('not really aac, and never logged');

function harness({ available = true, result = { kind: 'accepted', memoId: 'm1', transcriptionLength: 25 }, fail = null, maxBytes } = {}) {
  const seen = { commands: [], events: [] };
  const api = {
    canSubmitMemo: () => available,
    memoConversationFor: (username) => (username === 'user_1' ? 'telegram:b1_c2' : null),
    submitMemo: async (command) => {
      seen.commands.push(command);
      if (fail) throw fail;
      return typeof result === 'function' ? result(command) : result;
    },
  };
  const record = (level) => (event, data) => seen.events.push({ level, event, data });
  const logger = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
  const app = express();
  app.post('/memo', ...journalistMemoRoute(api, { logger, ...(maxBytes ? { maxBytes } : {}) }));
  return { app, seen };
}

const post = (app, { user = 'user_1', id = 'm1', type = 'audio/mp4', body = AUDIO, recordedAt } = {}) => {
  let call = request(app).post('/memo');
  if (user !== null) call = call.query({ user });
  if (id !== null) call = call.set('X-Daylight-Memo-Id', id);
  if (recordedAt) call = call.set('X-Daylight-Recorded-At', String(recordedAt));
  if (type !== null) call = call.set('Content-Type', type);
  return body === null ? call.send() : call.send(body);
};

const events = (seen, name) => seen.events.filter((e) => e.event === name);

test('an accepted memo answers 200 with its id and reaches the journal as audio', async () => {
  const { app, seen } = harness();
  const res = await post(app, { recordedAt: 1700000000000 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, memoId: 'm1', duplicate: false, transcriptionLength: 25 });
  assert.equal(seen.commands.length, 1);
  const command = seen.commands[0];
  assert.equal(command.conversationId, 'telegram:b1_c2');
  assert.equal(command.username, 'user_1');
  assert.equal(command.memoId, 'm1');
  assert.equal(command.mimeType, 'audio/mp4');
  assert.ok(command.audioBuffer.equals(AUDIO));
  assert.equal(events(seen, 'journalist.memo.received').length, 1);
  assert.equal(events(seen, 'journalist.memo.accepted')[0].data.bytes, AUDIO.length);
});

test('a duplicate answers 200 with duplicate true', async () => {
  const { app, seen } = harness({ result: { kind: 'duplicate', memoId: 'm1' } });
  const res = await post(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, memoId: 'm1', duplicate: true });
  assert.equal(events(seen, 'journalist.memo.duplicate').length, 1);
});

test('content type parameters are dropped before the audio is handed on', async () => {
  const { app, seen } = harness();
  const res = await post(app, { type: 'Audio/MP4; codecs="mp4a.40.2"' });
  assert.equal(res.status, 200);
  assert.equal(seen.commands[0].mimeType, 'audio/mp4');
});

test('a request with no user is refused', async () => {
  const { app, seen } = harness();
  const res = await post(app, { user: null });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'user_required');
  assert.equal(seen.commands.length, 0);
  assert.equal(events(seen, 'journalist.memo.rejected')[0].data.reason, 'user_required');
});

test('a user with no Journalist conversation is refused', async () => {
  const { app, seen } = harness();
  const res = await post(app, { user: 'nobody' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'unknown_user');
  assert.equal(seen.commands.length, 0);
});

test('a missing or malformed memo id is refused', async () => {
  const { app, seen } = harness();
  for (const id of [null, 'has space', 'x'.repeat(65), 'semi;colon']) {
    const res = await post(app, { id });
    assert.equal(res.status, 400, `id ${id}`);
    assert.equal(res.body.error, 'invalid_memo_id');
  }
  assert.equal(seen.commands.length, 0);
});

test('a body that is not audio is refused', async () => {
  const { app, seen } = harness();
  for (const type of ['application/json', 'application/octet-stream', 'video/mp4', 'audio/flac']) {
    const res = await post(app, { type, body: type === 'application/json' ? '{"a":1}' : AUDIO });
    assert.equal(res.status, 415, type);
    assert.equal(res.body.error, 'unsupported_media_type');
  }
  assert.equal(seen.commands.length, 0);
});

test('an empty body is refused', async () => {
  const { app, seen } = harness();
  const res = await post(app, { body: null });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'empty_body');
  assert.equal(seen.commands.length, 0);
});

test('a body over the limit is refused, declared or not', async () => {
  const { app, seen } = harness({ maxBytes: 64 });
  const declared = await post(app, { body: Buffer.alloc(65, 1) });
  assert.equal(declared.status, 413);
  assert.equal(declared.body.error, 'too_large');
  assert.equal(declared.body.maxBytes, 64);

  // Chunked: no Content-Length for the gate to read, so the body reader stops it.
  const chunked = await new Promise((resolve, reject) => {
    const call = request(app).post('/memo').query({ user: 'user_1' })
      .set('X-Daylight-Memo-Id', 'm2').set('Content-Type', 'audio/mp4').set('Transfer-Encoding', 'chunked');
    call.write(Buffer.alloc(40, 1));
    call.write(Buffer.alloc(40, 1));
    call.end((err, res) => {
      const answer = res || err?.response;
      return answer ? resolve(answer) : reject(err);
    });
  });
  assert.equal(chunked.status, 413);
  assert.equal(chunked.body.error, 'too_large');
  assert.equal(seen.commands.length, 0);
  assert.equal(events(seen, 'journalist.memo.rejected').length, 2);
});

test('the default limit is 25 MB', () => {
  assert.equal(MEMO_MAX_BYTES, 25 * 1024 * 1024);
});

test('audio with nothing intelligible answers 422', async () => {
  const { app, seen } = harness({ result: { kind: 'empty_transcription', memoId: 'm1' } });
  const res = await post(app);
  assert.equal(res.status, 422);
  assert.deepEqual(res.body, { ok: false, error: 'empty_transcription', memoId: 'm1' });
  assert.equal(events(seen, 'journalist.memo.rejected')[0].data.reason, 'empty_transcription');
});

test('with the voice path unavailable the route says so and can be retried', async () => {
  const { app, seen } = harness({ available: false });
  const res = await post(app);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'unavailable');
  assert.equal(seen.commands.length, 0);
});

test('a failure while processing answers 500 without the cause', async () => {
  const { app, seen } = harness({ fail: new Error('whisper said: the secret words') });
  const res = await post(app);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'processing_failed', memoId: 'm1' });
  const failed = events(seen, 'journalist.memo.failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].level, 'error');
});

test('no event carries the audio', async () => {
  const { app, seen } = harness();
  await post(app);
  const logged = JSON.stringify(seen.events);
  assert.ok(!logged.includes(AUDIO.toString()));
  for (const { data } of seen.events) {
    for (const value of Object.values(data)) assert.ok(!Buffer.isBuffer(value));
  }
});
