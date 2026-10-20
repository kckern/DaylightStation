import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createOAuthRouter } from './oauth.mjs';

const REDIRECT = 'https://example.test/api/v1/admin/oauth/withings/callback';
const TOKENS = { userid: '42', access_token: 'a', refresh_token: 'r', scope: 'user.metrics', token_type: 'Bearer', expires_at: '2026-10-20T22:00:00.000Z' };

function build({ exchangeCode = vi.fn().mockResolvedValue(TOKENS), harvest = vi.fn().mockResolvedValue({ status: 'ok' }), save = vi.fn().mockResolvedValue(undefined), now } = {}) {
  const withingsOAuth = {
    authorizeUrl: vi.fn(({ redirectUri, state }) => `https://auth.example.test/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`),
    exchangeCode,
  };
  const harvester = { resetAuth: vi.fn() };
  const harvesterService = { get: vi.fn(() => harvester), harvest };
  const authStore = { save };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/oauth', createOAuthRouter({
    withingsOAuth, authStore, harvesterService, logger,
    resolveUsername: () => 'head',
    redirectUri: () => REDIRECT,
    newState: randomUUID,
    ...(now ? { now } : {}),
  }));
  return { app, withingsOAuth, harvester, harvesterService, authStore, logger };
}

async function connect(app, query = '?user=alice') {
  const res = await request(app).get(`/oauth/withings/connect${query}`);
  return { res, state: new URL(res.headers.location).searchParams.get('state') };
}

describe('admin OAuth router: Withings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requires its collaborators', () => {
    expect(() => createOAuthRouter({})).toThrow(TypeError);
  });

  it('redirects /connect to the authorize URL with a random state', async () => {
    const { app, withingsOAuth } = build();
    const first = await connect(app);
    const second = await connect(app);
    expect(first.res.status).toBe(302);
    expect(first.res.headers.location).toMatch(/^https:\/\/auth\.example\.test\/authorize\?/);
    expect(first.state).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.state).not.toBe(first.state);
    expect(withingsOAuth.authorizeUrl).toHaveBeenCalledWith({ redirectUri: REDIRECT, state: first.state });
  });

  it('exchanges the code, saves the grant, resets auth and starts a harvest', async () => {
    const { app, withingsOAuth, authStore, harvester, harvesterService } = build();
    const { state } = await connect(app);
    const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Withings connected');
    expect(withingsOAuth.exchangeCode).toHaveBeenCalledWith({ code: 'c', redirectUri: REDIRECT });
    expect(authStore.save).toHaveBeenCalledWith('alice', 'withings', TOKENS);
    expect(harvesterService.get).toHaveBeenCalledWith('withings');
    expect(harvester.resetAuth).toHaveBeenCalled();
    expect(harvesterService.harvest).toHaveBeenCalledWith('withings', 'alice');
  });

  it('falls back to the head of household when ?user is missing or not a string', async () => {
    const { app, authStore } = build();
    for (const query of ['', '?user=a&user=b']) {
      const { state } = await connect(app, query);
      await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    }
    expect(authStore.save.mock.calls.map((c) => c[0])).toEqual(['head', 'head']);
  });

  it('rejects an unknown state without exchanging', async () => {
    const { app, withingsOAuth } = build();
    const res = await request(app).get('/oauth/withings/callback?code=c&state=nope');
    expect(res.status).toBe(400);
    expect(res.text).toContain('expired or was already used');
    expect(withingsOAuth.exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a reused state', async () => {
    const { app, withingsOAuth } = build();
    const { state } = await connect(app);
    await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    const again = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(again.status).toBe(400);
    expect(withingsOAuth.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('rejects a state older than ten minutes', async () => {
    let t = 1_000_000;
    const { app, withingsOAuth } = build({ now: () => t });
    const { state } = await connect(app);
    t += 10 * 60 * 1000 + 1;
    const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(res.status).toBe(400);
    expect(withingsOAuth.exchangeCode).not.toHaveBeenCalled();
  });

  it('keeps at most 20 pending states, dropping the oldest', async () => {
    const { app, withingsOAuth } = build();
    const states = [];
    for (let i = 0; i < 21; i++) states.push((await connect(app)).state);
    const oldest = await request(app).get(`/oauth/withings/callback?code=c&state=${states[0]}`);
    expect(oldest.status).toBe(400);
    const newest = await request(app).get(`/oauth/withings/callback?code=c&state=${states[20]}`);
    expect(newest.status).toBe(200);
    const second = await request(app).get(`/oauth/withings/callback?code=c&state=${states[1]}`);
    expect(second.status).toBe(200);
    expect(withingsOAuth.exchangeCode).toHaveBeenCalledTimes(2);
  });

  it('shows the Withings error, HTML-escaped', async () => {
    const { app, withingsOAuth } = build();
    const res = await request(app).get('/oauth/withings/callback?error=' + encodeURIComponent('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
    expect(res.type).toBe('text/html');
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(withingsOAuth.exchangeCode).not.toHaveBeenCalled();
  });

  it('names access_denied', async () => {
    const { app } = build();
    const res = await request(app).get('/oauth/withings/callback?error=access_denied');
    expect(res.status).toBe(400);
    expect(res.text).toContain('access_denied');
  });

  it('returns 502 with the escaped message when the exchange is rejected; nothing saved', async () => {
    const { app, authStore, harvesterService } = build({
      exchangeCode: vi.fn().mockRejectedValue(new Error('Withings rejected the code: <b>invalid</b>')),
    });
    const { state } = await connect(app);
    const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(res.status).toBe(502);
    expect(res.text).toContain('Withings rejected the code: &lt;b&gt;invalid&lt;/b&gt;');
    expect(authStore.save).not.toHaveBeenCalled();
    expect(harvesterService.harvest).not.toHaveBeenCalled();
  });

  it('returns 500 HTML when the grant cannot be saved', async () => {
    const { app, harvesterService } = build({ save: vi.fn().mockRejectedValue(new Error('disk full')) });
    const { state } = await connect(app);
    const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(res.status).toBe(500);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('disk full');
    expect(harvesterService.harvest).not.toHaveBeenCalled();
  });

  it('a failing first harvest does not cause an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { app, logger } = build({ harvest: vi.fn().mockRejectedValue(new Error('boom')) });
      const { state } = await connect(app);
      const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('oauth.withings.first_harvest_failed', expect.objectContaining({ error: 'boom' }));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a harvest that throws synchronously does not break the response', async () => {
    const { app } = build({ harvest: vi.fn(() => { throw new Error('sync boom'); }) });
    const { state } = await connect(app);
    const res = await request(app).get(`/oauth/withings/callback?code=c&state=${state}`);
    expect(res.status).toBe(200);
  });
});
