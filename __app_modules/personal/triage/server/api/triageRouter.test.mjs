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

describe('triage schedule with nobody enrolled', () => {
  it('warns schedules:0 and registers nothing', () => {
    const warn = vi.fn();
    const tasks = [];
    const rt = createTriageRuntime({
      configuration: () => ({ triage: { enabled: true, users: {} } }), defaultUsername: 'x', isKnownUser: () => true,
      dataService: { user: { readStrict: async () => null, writeAtomic: async () => true } }, mailbox: null, work: null,
      clock: () => 0, logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    });
    rt.registerSchedule({ registerTask: (...a) => tasks.push(a) });
    expect(tasks).toEqual([]);
    expect(warn).toHaveBeenCalledWith('triage.schedule.empty', expect.objectContaining({ schedules: 0 }));
  });
});

describe('session routes', () => {
  const ENROLLED = { triage: { enabled: true, defaults: { mode: 'live' }, users: { sample: {} } } };
  const NOW = Date.parse('2026-11-19T17:00:00Z');
  const card = {
    cardId: 'card.x', passId: 'p', createdAt: NOW, itemId: 'item.x', kind: 'email',
    ref: { provider: 'mx', accountId: 'sample', kind: 'message', id: 'm1' }, itemVersion: 'v1', step: 'unsure', urgent: false,
    choices: [{ key: 'archive', label: 'Archive' }, { key: 'keep', label: 'Keep' }], suggested: 'archive', confidence: 0.5,
    why: 'Unsure', preDo: null, status: 'open', display: { title: 'Hello', from: { name: 'P', address: 'p@example.com' }, snippet: 's' },
  };
  const build = () => {
    const files = new Map([['sample/apps/triage/queue', { passId: 'p', builtAt: NOW - 1000, mailbox: 'ok', preDone: { archived: 2, closed: 0 }, cards: [card] }]]);
    const mailbox = {
      capabilities: () => ({ read: true, modify: true, compose: true, send: true }),
      getMessage: vi.fn(async () => ({ version: 'v1', labels: ['INBOX'] })), archive: vi.fn(async () => ({ version: 'v2' })),
    };
    const rt = createTriageRuntime({
      configuration: () => ENROLLED, defaultUsername: 'sample', isKnownUser: u => ['head', 'sample'].includes(u),
      dataService: { user: {
        readStrict: async (p, u) => structuredClone(files.get(`${u}/${p}`) ?? null),
        writeAtomic: async (p, d, u) => { files.set(`${u}/${p}`, structuredClone(d)); return true; },
      } },
      mailbox, work: null, clock: () => NOW, logger: null,
    });
    return { rt, files, mailbox };
  };
  const appAs = (rt, user) => express()
    .use((req, _res, next) => { if (user) req.user = user; next(); })
    .use('/t', rt.router);

  it('POST /cards/x/answer without a login -> 401 login_required', async () => {
    const { rt, mailbox } = build();
    const res = await request(appAs(rt, null)).post('/t/cards/card.x/answer?username=sample').send({ choice: 'archive' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login_required');
    expect(mailbox.archive).not.toHaveBeenCalled();
  });
  it('a session for another user -> 403 session_user_mismatch', async () => {
    const { rt } = build();
    const res = await request(appAs(rt, { sub: 'head', sid: 's1' })).post('/t/cards/card.x/answer?username=sample').send({ choice: 'archive' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('session_user_mismatch');
  });
  it('GET /session and /log need a login; /summary does not', async () => {
    const { rt } = build();
    expect((await request(appAs(rt, null)).get('/t/session?username=sample')).status).toBe(401);
    expect((await request(appAs(rt, null)).get('/t/log?username=sample')).status).toBe(401);
    const sum = await request(appAs(rt, null)).get('/t/summary?username=sample');
    expect(sum.status).toBe(200);
    expect(sum.body).toMatchObject({ enrolled: true, mode: 'live', mailbox: 'ok', preDone: { archived: 2, closed: 0 }, open: { unsure: 1, reply: 0, todo: 0 } });
  });
  it('serves the session and applies an answer with a login', async () => {
    const { rt, files, mailbox } = build();
    const a = appAs(rt, { sub: 'sample', sid: 's1' });
    const ses = await request(a).get('/t/session');
    expect(ses.status).toBe(200);
    expect(ses.body.cards.map(c => c.cardId)).toEqual(['card.x']);
    const res = await request(a).post('/t/cards/card.x/answer').send({ choice: 'archive' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('applied');
    expect(mailbox.archive).toHaveBeenCalledWith('sample', 'm1');
    expect(files.get('sample/apps/triage/queue').cards[0].status).toBe('answered');
    const log = await request(a).get('/t/log?sinceDays=7');
    expect(log.body.entries).toEqual([expect.objectContaining({ actor: 'owner', action: 'archive', undoable: true })]);
  });
  it('404s an unknown card, 409s an answered one, 400s a bad choice', async () => {
    const { rt } = build();
    const a = appAs(rt, { sub: 'sample', sid: 's1' });
    expect((await request(a).post('/t/cards/nope/answer').send({ choice: 'archive' })).status).toBe(404);
    expect((await request(a).post('/t/cards/card.x/answer').send({ choice: 'task' })).status).toBe(400);
    await request(a).post('/t/cards/card.x/answer').send({ choice: 'keep' });
    expect((await request(a).post('/t/cards/card.x/answer').send({ choice: 'keep' })).status).toBe(409);
  });
  it('skip leaves the card open; undo needs a login', async () => {
    const { rt, files } = build();
    const a = appAs(rt, { sub: 'sample', sid: 's1' });
    expect((await request(a).post('/t/cards/card.x/skip')).status).toBe(200);
    expect(files.get('sample/apps/triage/queue').cards[0].status).toBe('open');
    expect((await request(appAs(rt, null)).post('/t/log/log.1/undo?username=sample')).status).toBe(401);
  });
});

describe('session route conflicts (fix round 1)', () => {
  it('maps a busy lock to 409 pass_running and an in-doubt card to 409 answer_in_doubt', async () => {
    const answer = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'TRIAGE_BUSY', holder: 'pass' }))
      .mockRejectedValueOnce(Object.assign(new Error('doubt'), { code: 'TRIAGE_ANSWER_IN_DOUBT', status: 'applying' }));
    const { createTriageRouter } = await import('./triageRouter.mjs');
    const router = createTriageRouter({
      resolvePolicy: () => ({ enrolled: true, mode: 'live' }), defaultUsername: 'sample', isKnownUser: () => true,
      session: { answer }, logger: null,
    });
    const a = express().use((req, _r, n) => { req.user = { sub: 'sample', sid: 's1' }; n(); }).use('/t', router);
    const busy = await request(a).post('/t/cards/c/answer').send({ choice: 'send' });
    expect([busy.status, busy.body.error]).toEqual([409, 'pass_running']);
    const doubt = await request(a).post('/t/cards/c/answer').send({ choice: 'send' });
    expect([doubt.status, doubt.body.error]).toEqual([409, 'answer_in_doubt']);
  });
});

describe('POST /cards/:cardId/resolve', () => {
  const mk = (resolve) => {
    return import('./triageRouter.mjs').then(({ createTriageRouter }) => {
      const router = createTriageRouter({
        resolvePolicy: () => ({ enrolled: true, mode: 'live' }), defaultUsername: 'sample', isKnownUser: () => true,
        session: { resolve }, logger: null,
      });
      return (user) => express().use((req, _r, n) => { req.user = user; n(); }).use('/t', router);
    });
  };
  it('needs the owner login, a boolean, and maps CARD_NOT_APPLYING to 409', async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce({ outcome: 'applied' })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'TRIAGE_CARD_NOT_APPLYING', status: 'open' }));
    const app = await mk(resolve);
    expect((await request(app(null)).post('/t/cards/c/resolve?username=sample').send({ happened: true })).status).toBe(401);
    const a = app({ sub: 'sample', sid: 's1' });
    expect((await request(a).post('/t/cards/c/resolve').send({ happened: 'yes' })).status).toBe(400);
    expect((await request(a).post('/t/cards/c/resolve').send({ happened: true })).body.outcome).toBe('applied');
    expect(resolve).toHaveBeenCalledWith({ username: 'sample', cardId: 'c', happened: true });
    const no = await request(a).post('/t/cards/c/resolve').send({ happened: false });
    expect([no.status, no.body.error]).toEqual([409, 'CARD_NOT_APPLYING']);
  });
});
