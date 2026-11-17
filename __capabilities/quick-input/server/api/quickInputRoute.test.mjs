import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {
  quickInputRoute, quickInputPreflight, isQuickInputRequest, isCrossOriginRequest, isCrossSiteFetch, QUICK_INPUT_KINDS,
} from './quickInputRoute.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not really a photo, and never logged')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.from('webp body')]);
const AUDIO = Buffer.from('not really audio, and never logged');
const NOTE = 'Oatmeal with blueberries, and a coffee — never logged';

const BODY = { voice: AUDIO, text: NOTE, photo: JPEG };
const TYPE = { voice: 'audio/ogg', text: 'text/plain; charset=utf-8', photo: 'image/jpeg' };

function harness({ kind = 'text', available = true, result, fail = null, admission = { allowed: true }, naming, maxBytes } = {}) {
  const seen = { commands: [], events: [], admissions: [] };
  const endpoint = {
    available: () => available,
    deviceAllowed: (deviceId, username) => deviceId === 'fleet:phone' && ['user_1', 'user_2'].includes(username),
    conversationFor: (username) => (username === 'user_1' ? 'telegram:b1_c2' : null),
    admission: (question) => { seen.admissions.push(question); return admission; },
    submit: async (command) => {
      seen.commands.push(command);
      if (fail) throw fail;
      return result ?? { kind: 'accepted', inputId: command.inputId };
    },
  };
  const record = (level) => (event, data) => seen.events.push({ level, event, data });
  const logger = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
  const options = { kind, logger, naming: naming ?? { logContext: { bot: 'nutribot', kind } }, ...(maxBytes ? { maxBytes } : {}) };
  const app = express();
  app.options('/in', quickInputPreflight(options));
  app.post('/in', ...quickInputRoute(endpoint, options));
  return { app, seen };
}

const post = (app, kind, { user = 'user_1', id = 'i1', idHeader = 'X-Daylight-Input-Id', type = TYPE[kind], body = BODY[kind], device = 'fleet:phone', origin = null, recordedAt } = {}) => {
  let call = request(app).post('/in');
  if (user !== null) call = call.query({ user });
  if (device !== null) call = call.set('X-Daylight-Device', device);
  if (origin !== null) call = call.set('Origin', origin);
  if (id !== null) call = call.set(idHeader, id);
  if (recordedAt) call = call.set('X-Daylight-Recorded-At', String(recordedAt));
  if (type !== null) call = call.set('Content-Type', type);
  return body === null ? call.send() : call.send(body);
};

const events = (seen, name) => seen.events.filter((e) => e.event === name);

test('the kinds are the contract\'s: types and size limits', () => {
  assert.equal(QUICK_INPUT_KINDS.voice.maxBytes, 26214400);
  assert.equal(QUICK_INPUT_KINDS.text.maxBytes, 16384);
  assert.equal(QUICK_INPUT_KINDS.photo.maxBytes, 15728640);
  assert.deepEqual([...QUICK_INPUT_KINDS.text.types], ['text/plain']);
  assert.deepEqual([...QUICK_INPUT_KINDS.photo.types], ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(QUICK_INPUT_KINDS.voice.types.length, 8);
});

for (const kind of ['voice', 'text', 'photo']) {
  test(`an accepted ${kind} input answers 200 with its id and reaches the bot as bytes`, async () => {
    const { app, seen } = harness({ kind });
    const res = await post(app, kind, { recordedAt: 1700000000000 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, inputId: 'i1', duplicate: false });
    const [command] = seen.commands;
    assert.deepEqual(
      { ...command, body: null },
      { conversationId: 'telegram:b1_c2', username: 'user_1', inputId: 'i1', body: null, mimeType: TYPE[kind].split(';')[0], recordedAt: 1700000000000 },
    );
    assert.ok(command.body.equals(Buffer.from(BODY[kind])));
    const accepted = events(seen, 'quick_input.accepted')[0].data;
    assert.equal(accepted.bot, 'nutribot');
    assert.equal(accepted.kind, kind);
    assert.equal(accepted.inputId, 'i1');
    assert.equal(accepted.bytes, Buffer.from(BODY[kind]).length);
  });
}

test('the memo id header is taken as the input id', async () => {
  const { app, seen } = harness();
  const res = await post(app, 'text', { idHeader: 'X-Daylight-Memo-Id', id: 'from-memo-header' });
  assert.equal(res.status, 200);
  assert.equal(res.body.inputId, 'from-memo-header');
  assert.equal(seen.commands[0].inputId, 'from-memo-header');
});

test('what the bot adds to an accepted answer is passed on', async () => {
  const { app } = harness({ result: { kind: 'accepted', inputId: 'i1', transcriptionLength: 25 } });
  const res = await post(app, 'text');
  assert.deepEqual(res.body, { ok: true, inputId: 'i1', duplicate: false, transcriptionLength: 25 });
});

test('a duplicate and a finished retry both answer duplicate true', async () => {
  for (const outcome of ['duplicate', 'resumed']) {
    const { app, seen } = harness({ result: { kind: outcome, inputId: 'i1' } });
    const res = await post(app, 'text');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, inputId: 'i1', duplicate: true });
    assert.equal(events(seen, 'quick_input.duplicate')[0].data.resumed, outcome === 'resumed');
  }
});

test('a route can carry the id under more than one name', async () => {
  const { app } = harness({ naming: { idFields: ['inputId', 'memoId'] }, result: { kind: 'empty_transcription', inputId: 'i1' } });
  const res = await post(app, 'text');
  assert.deepEqual(res.body, { ok: false, error: 'empty_transcription', inputId: 'i1', memoId: 'i1' });
});

test('the refusals come in the contract\'s order, all before the body is read', async () => {
  const { app, seen } = harness({ admission: { allowed: false, limit: 'inputs', retryAfterSeconds: 1 } });
  const wrong = { origin: 'https://elsewhere.example', user: null, device: null, id: 'bad id', type: 'application/json', body: '{"text":"x"}' };
  const order = [
    ['origin', null, 403, 'cross_origin'],
    ['user', 'user_2', 400, 'user_required'],
    ['device', 'fleet:phone', 403, 'device_not_allowed'],
    ['user', 'user_1', 404, 'unknown_user'],
    ['id', 'i1', 400, 'invalid_input_id'],
    ['type', 'text/plain', 415, 'unsupported_media_type'],
  ];
  for (const [field, fixed, status, expected] of order) {
    const res = await post(app, 'text', wrong);
    assert.equal(res.body.error, expected);
    assert.equal(res.status, status);
    assert.equal(res.body.ok, false);
    assert.equal(typeof res.body.message, 'string');
    wrong[field] = fixed;
  }
  const limited = await post(app, 'text', wrong);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { ok: false, error: 'daily_limit', message: limited.body.message, limit: 'inputs', retryAfterSeconds: 1 });
  assert.equal(limited.headers['retry-after'], '1');
  assert.equal(seen.commands.length, 0);
});

test('a missing or malformed input id is refused', async () => {
  const { app } = harness();
  for (const id of [null, 'has space', 'x'.repeat(65), 'semi;colon']) {
    const res = await post(app, 'text', { id });
    assert.equal(res.status, 400, String(id));
    assert.equal(res.body.error, 'invalid_input_id');
  }
});

test('each kind refuses the other kinds\' content types', async () => {
  for (const [kind, others] of [['voice', ['text/plain', 'image/jpeg', 'audio/flac']], ['text', ['audio/ogg', 'application/json', 'text/html']], ['photo', ['image/gif', 'audio/ogg', 'application/octet-stream']]]) {
    const { app, seen } = harness({ kind });
    for (const type of others) {
      const res = await post(app, kind, { type, body: Buffer.from('x') });
      assert.equal(res.status, 415, `${kind} ${type}`);
    }
    assert.equal(seen.commands.length, 0);
  }
});

test('a body over the kind\'s limit is refused, declared or not', async () => {
  const { app, seen } = harness({ kind: 'text' });
  const res = await post(app, 'text', { body: 'x'.repeat(16385) });
  assert.equal(res.status, 413);
  assert.deepEqual(res.body, { ok: false, error: 'too_large', message: res.body.message, maxBytes: 16384 });

  const chunked = await new Promise((resolve, reject) => {
    const call = request(app).post('/in').query({ user: 'user_1' })
      .set('X-Daylight-Input-Id', 'i2').set('Content-Type', 'text/plain').set('Transfer-Encoding', 'chunked')
      .set('X-Daylight-Device', 'fleet:phone');
    call.write('x'.repeat(9000));
    call.write('x'.repeat(9000));
    call.end((err, answer) => ((answer || err?.response) ? resolve(answer || err.response) : reject(err)));
  });
  assert.equal(chunked.status, 413);
  assert.equal(seen.commands.length, 0);
});

test('an empty body, and text with nothing in it, are refused', async () => {
  const { app, seen } = harness({ kind: 'text' });
  for (const body of [null, '   \n\t ']) {
    const res = await post(app, 'text', { body });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'empty_body');
  }
  assert.equal(seen.commands.length, 0);
});

test('text that is not UTF-8 cannot be read', async () => {
  const { app, seen } = harness({ kind: 'text' });
  const res = await post(app, 'text', { body: Buffer.from([0x68, 0x69, 0xff, 0xfe]) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'unreadable_body');
  assert.equal(seen.commands.length, 0);
});

test('bytes that are not the image they claim to be are unusable, and no model is asked', async () => {
  const { app, seen } = harness({ kind: 'photo' });
  for (const [type, body] of [['image/jpeg', PNG], ['image/png', JPEG], ['image/webp', Buffer.from('RIFFxxxxWAVE')], ['image/jpeg', Buffer.from('hello')]]) {
    const res = await post(app, 'photo', { type, body });
    assert.equal(res.status, 422, type);
    assert.deepEqual(res.body, { ok: false, error: 'unusable_input', inputId: 'i1' });
  }
  for (const [type, body] of [['image/png', PNG], ['image/webp', WEBP], ['image/jpeg', JPEG]]) {
    assert.equal((await post(app, 'photo', { type, body })).status, 200, type);
  }
  assert.equal(seen.commands.length, 3);
});

test('each outcome a bot can report has its answer', async () => {
  const cases = [
    [{ kind: 'empty_transcription', inputId: 'i1' }, 422, { ok: false, error: 'empty_transcription', inputId: 'i1' }],
    [{ kind: 'unusable_input', inputId: 'i1' }, 422, { ok: false, error: 'unusable_input', inputId: 'i1' }],
    [{ kind: 'unavailable', inputId: 'i1' }, 503, null],
    [{ kind: 'daily_limit', inputId: 'i1', limit: 'bytes', retryAfterSeconds: 120 }, 429, null],
    [{ kind: 'something-new', inputId: 'i1' }, 500, { ok: false, error: 'processing_failed', inputId: 'i1' }],
  ];
  for (const [result, status, body] of cases) {
    const { app } = harness({ result });
    const res = await post(app, 'text');
    assert.equal(res.status, status, result.kind);
    if (body) assert.deepEqual(res.body, body);
  }
});

test('a failure while processing answers 500 without the cause', async () => {
  const { app, seen } = harness({ fail: new Error('the model said: the secret words') });
  const res = await post(app, 'text');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'processing_failed', inputId: 'i1' });
  assert.equal(events(seen, 'quick_input.failed')[0].level, 'error');
});

test('with the bot unavailable the route says so', async () => {
  const { app } = harness({ available: false });
  const res = await post(app, 'text');
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'unavailable');
});

test('a request or preflight from another origin is refused with no CORS grant', async () => {
  const { app } = harness();
  const res = await post(app, 'text', { origin: 'https://elsewhere.example' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'cross_origin');
  const preflight = await request(app).options('/in').set('Origin', 'https://elsewhere.example').set('Access-Control-Request-Method', 'POST');
  assert.equal(preflight.status, 403);
  for (const answer of [res, preflight]) {
    for (const header of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']) {
      assert.equal(answer.headers[header], undefined);
    }
  }
});

test('nothing typed, spoken or photographed is in any event', async () => {
  for (const kind of ['voice', 'text', 'photo']) {
    const { app, seen } = harness({ kind });
    await post(app, kind);
    assert.ok(seen.events.length > 0);
    const logged = JSON.stringify(seen.events);
    assert.ok(!logged.includes('never logged'), kind);
    for (const { data } of seen.events) {
      for (const value of Object.values(data)) assert.ok(!Buffer.isBuffer(value));
    }
  }
});

test('a quick input is told apart from another shape of request on the same path', () => {
  const req = (method, headers) => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { method, get: (name) => lower[name.toLowerCase()] };
  };
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'text/plain; charset=utf-8' }), 'text'), true);
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'audio/ogg', 'X-Daylight-Input-Id': 'a' }), 'text'), true);
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'image/jpeg', 'X-Daylight-Memo-Id': 'a' }), 'text'), true);
  assert.equal(isQuickInputRequest(req('POST', { 'X-Daylight-Device': 'fleet:phone' }), 'text'), true);
  // A JSON or form body is the earlier shape, whatever else the request carries.
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'application/json', 'X-Daylight-Input-Id': 'a', 'X-Daylight-Device': 'fleet:phone' }), 'text'), false);
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'X-Daylight-Device': 'fleet:phone' }), 'text'), false);
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'application/json' }), 'text'), false);
  assert.equal(isQuickInputRequest(req('POST', { 'Content-Type': 'application/x-www-form-urlencoded' }), 'text'), false);
  assert.equal(isQuickInputRequest(req('GET', { 'Content-Type': 'text/plain' }), 'text'), false);
  assert.equal(isQuickInputRequest(req('POST', {}), 'text'), false);
});

test('a request from another site is recognised by its Origin or by the browser\'s fetch metadata', () => {
  const req = (headers) => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name) => lower[name.toLowerCase()] };
  };
  assert.equal(isCrossOriginRequest(req({ Host: 'station.example' })), false);
  assert.equal(isCrossOriginRequest(req({ Host: 'station.example', Origin: 'https://station.example' })), false);
  assert.equal(isCrossOriginRequest(req({ Host: 'station.example', Origin: 'https://elsewhere.example' })), true);
  assert.equal(isCrossOriginRequest(req({ Host: 'station.example', Origin: 'null' })), true);
  // A cross-site GET (an image tag, a link) carries no Origin; the browser still says where it came from.
  assert.equal(isCrossSiteFetch(req({ 'Sec-Fetch-Site': 'cross-site' })), true);
  assert.equal(isCrossSiteFetch(req({ 'Sec-Fetch-Site': 'same-site' })), true);
  assert.equal(isCrossSiteFetch(req({ 'Sec-Fetch-Site': 'same-origin' })), false);
  assert.equal(isCrossSiteFetch(req({ 'Sec-Fetch-Site': 'none' })), false);
  assert.equal(isCrossSiteFetch(req({})), false);
});
