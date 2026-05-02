import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { createBrainRouter } from '../../../../src/4_api/v1/routers/brain.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function buildApp({ findByToken, runChat, streamChat }) {
  const app = express();
  app.use(express.json());
  app.use('/v1', createBrainRouter({
    satelliteRegistry: { findByToken, list: async () => [] },
    chatCompletionRunner: { runChat, streamChat },
    logger: silentLogger,
    advertisedModels: ['daylight-house'],
  }));
  return app;
}

describe('createBrainRouter', () => {
  let runChat;
  let streamChat;
  let findByToken;

  beforeEach(() => {
    runChat = async () => ({ content: 'hi', toolCalls: [], usage: null });
    streamChat = async function* () { yield { type: 'finish' }; };
    findByToken = async (t) => (t === 'good' ? { id: 's', allowedSkills: ['memory'] } : null);
  });

  it('returns 401 on missing token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.error.code, 'missing_token');
  });

  it('returns 401 on bad token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer bad')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.error.code, 'invalid_token');
  });

  it('returns 200 with envelope on good token', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer good')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.object, 'chat.completion');
    assert.strictEqual(r.body.choices[0].message.content, 'hi');
  });

  it('GET /v1/models returns advertised list (with token)', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer good');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.object, 'list');
    assert.deepStrictEqual(r.body.data.map((m) => m.id), ['daylight-house']);
  });

  it('GET /v1/models also requires bearer auth', async () => {
    const app = buildApp({ findByToken, runChat, streamChat });
    const r = await request(app).get('/v1/models');
    assert.strictEqual(r.status, 401);
  });
});
