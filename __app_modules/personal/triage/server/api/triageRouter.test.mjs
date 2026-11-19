import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createTriageRuntime } from '../composition.mjs';

const make = (configuration = {}) => createTriageRuntime({
  configuration: () => configuration, defaultUsername: 'head', isKnownUser: u => ['head', 'sample'].includes(u),
  dataService: null, mailbox: null, work: null, decisionGateway: null, aiGateway: null, agentsScheduler: null,
  clock: () => 0, logger: null,
});
const app = (rt) => express().use('/api/v1/triage', rt.router);

describe('triage router', () => {
  it('reports the default user as not enrolled', async () => {
    const res = await request(app(make())).get('/api/v1/triage/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'head', enrolled: false, mode: 'off' });
  });
  it('404s an unknown user', async () => {
    expect((await request(app(make())).get('/api/v1/triage/status?username=ghost')).status).toBe(404);
  });
  it('reports an enrolled user', async () => {
    const cfg = { triage: { enabled: true, defaults: { mode: 'dryRun' }, users: { sample: {} } } };
    const res = await request(app(make(cfg))).get('/api/v1/triage/status?username=sample');
    expect(res.body).toEqual({ username: 'sample', enrolled: true, mode: 'dryRun' });
  });
});

describe('POST /run', () => {
  const ENROLLED = { triage: { enabled: true, defaults: { mode: 'dryRun' }, users: { sample: {} } } };
  const runtimeWith = (configuration, overrides = {}) => {
    const files = new Map();
    const dataService = { user: {
      readStrict: async (p, u) => structuredClone(files.get(`${u}/${p}`) ?? null),
      writeAtomic: async (p, d, u) => { files.set(`${u}/${p}`, structuredClone(d)); return true; },
    } };
    const mailbox = {
      capabilities: () => ({ read: true, modify: true, compose: true, send: true }),
      listInbox: async () => [], archive: async () => ({}), senderHistory: async () => ({ sentToCount: 0 }),
      createDraft: async () => ({ draftId: 'd' }),
    };
    return createTriageRuntime({
      configuration: () => configuration, defaultUsername: 'head', isKnownUser: u => ['head', 'sample'].includes(u),
      dataService, mailbox, work: null, decisionGateway: null, aiGateway: null, agentsScheduler: null,
      clock: () => Date.parse('2026-11-19T05:00:00Z'), logger: null, ...overrides,
    });
  };
  const appAs = (rt, user) => express()
    .use((req, _res, next) => { if (user) req.user = user; next(); })
    .use('/api/v1/triage', rt.router);

  it('401s without a login session', async () => {
    const res = await request(appAs(runtimeWith(ENROLLED), null)).post('/api/v1/triage/run?username=sample');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login_required');
  });
  it('403s a session for another user', async () => {
    const res = await request(appAs(runtimeWith(ENROLLED), { sub: 'head', sid: 's1' })).post('/api/v1/triage/run?username=sample');
    expect(res.status).toBe(403);
  });
  it('runs a manual pass and returns its summary', async () => {
    const res = await request(appAs(runtimeWith(ENROLLED), { sub: 'sample', sid: 's1' })).post('/api/v1/triage/run');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preDone: { archived: 0, closed: 0 }, queued: { unsure: 0, reply: 0, todo: 0, urgent: 0 }, mailbox: 'ok' });
    expect(res.body.passId).toMatch(/^pass\./);
  });
  it('returns skipped not_enrolled with 200 for a user who is not enrolled', async () => {
    const res = await request(appAs(runtimeWith(ENROLLED), { sub: 'head', sid: 's1' })).post('/api/v1/triage/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skipped: 'not_enrolled' });
  });
});

describe('triage schedule', () => {
  it('registers one triage:pass task that runs each enrolled user in turn', async () => {
    const configuration = { triage: { enabled: true, defaults: { mode: 'dryRun' }, users: { sample: {}, head: { mode: 'off' } } } };
    const tasks = [];
    const scheduler = { registerTask: (key, cron, handler) => tasks.push({ key, cron, handler }) };
    const files = new Map();
    const listInbox = [];
    const rt = createTriageRuntime({
      configuration: () => configuration, defaultUsername: 'head', isKnownUser: () => true,
      dataService: { user: { readStrict: async (p, u) => files.get(`${u}/${p}`) ?? null, writeAtomic: async (p, d, u) => { files.set(`${u}/${p}`, d); return true; } } },
      mailbox: { capabilities: () => ({ read: true, modify: true, compose: true }), listInbox: async (u) => { listInbox.push(u); return []; } },
      work: null, clock: () => Date.parse('2026-11-19T05:00:00Z'), logger: null,
    });
    rt.registerSchedule(scheduler);
    expect(tasks.map(t => [t.key, t.cron])).toEqual([['triage:pass', '0 5 * * *']]);
    await tasks[0].handler();
    expect(listInbox).toEqual(['sample']);
  });
});

describe('POST /run failure', () => {
  it('500s with triage_pass_failed when the pass throws', async () => {
    const cfg = { triage: { enabled: true, users: { sample: {} } } };
    const rt = createTriageRuntime({
      configuration: () => cfg, defaultUsername: 'sample', isKnownUser: () => true,
      dataService: { user: { readStrict: async () => { throw new Error('corrupt'); }, writeAtomic: async () => true } },
      mailbox: null, work: null, clock: () => 0, logger: null,
    });
    const res = await request(express().use((req, _r, n) => { req.user = { sub: 'sample', sid: 's' }; n(); }).use('/t', rt.router)).post('/t/run');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'triage_pass_failed' });
  });
});

describe('mailbox wiring', () => {
  it('builds the mailbox from createMailClient and a pass reads through it', async () => {
    const cfg = { triage: { enabled: true, users: { sample: {} } } };
    const files = new Map();
    const createMailClient = vi.fn(async () => { throw new Error('no credentials'); });
    const rt = createTriageRuntime({
      configuration: () => cfg, defaultUsername: 'sample', isKnownUser: () => true, createMailClient,
      dataService: { user: { readStrict: async (p, u) => files.get(`${u}/${p}`) ?? null, writeAtomic: async (p, d, u) => { files.set(`${u}/${p}`, d); return true; } } },
      work: null, clock: () => Date.parse('2026-11-19T05:00:00Z'), logger: null,
    });
    const r = await rt.pass.run({ username: 'sample', trigger: 'manual' });
    expect(createMailClient).toHaveBeenCalledWith('sample');
    expect(r.mailbox).toBe('ok');
  });
});
