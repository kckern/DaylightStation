import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthRouter } from './auth.mjs';
import { createCalendarRouter } from './calendar.mjs';
import { createEntropyRouter } from './entropy.mjs';
import { createHarvestRouter } from './harvest.mjs';
import { createLifelogRouter } from './lifelog.mjs';
import { createMediaRouter } from './media.mjs';
import { createHomeDashboardRouter } from './home-dashboard.mjs';
import { createJournalistRouter } from './journalist.mjs';
import { createNutribotRouter } from './nutribot.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
function mount(path, router, { json = true } = {}) {
  const app = express();
  if (json) app.use(express.json());
  app.use(path, router);
  return app;
}

describe('config-backed semantic API seams', () => {
  it('preserves auth public-context envelope and request household precedence', async () => {
    const authPublicContext = { get: vi.fn(() => ({
      householdId: 'host-house', householdName: 'Daylight', setupAdmin: 'admin',
    })) };
    const authService = { needsSetup: vi.fn(() => true) };
    const app = express();
    app.use((req, _res, next) => { req.householdId = 'host-house'; req.isLocal = true; next(); });
    app.use('/auth', createAuthRouter({
      authService, authPublicContext, jwtSecret: 'secret',
      jwtConfig: { issuer: 'issuer', expiry: '1h', algorithm: 'HS256' }, logger,
    }));

    const response = await request(app).get('/auth/context');
    expect(response.body).toEqual({
      householdId: 'host-house', householdName: 'Daylight', authMethod: 'password',
      isLocal: true, needsSetup: true, setupAdmin: 'admin',
    });
    expect(authPublicContext.get).toHaveBeenCalledWith({ householdId: 'host-house', needsSetup: true });
  });

  it('preserves calendar household override, timezone policy, and date envelope', async () => {
    const calendarReadContext = {
      resolveHousehold: vi.fn((explicit) => explicit || 'default'),
      timezone: vi.fn(() => 'UTC'),
      events: vi.fn(() => [{
        id: 'event-1', summary: 'Breakfast',
        start: { dateTime: '2026-08-28T08:00:00Z' }, end: { dateTime: '2026-08-28T09:00:00Z' },
      }]),
    };
    const app = mount('/calendar', createCalendarRouter({ calendarReadContext }));
    const response = await request(app).get('/calendar/events/2026-08-28?household=other');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'success', date: '2026-08-28', count: 1, _household: 'other' });
    expect(calendarReadContext.resolveHousehold).toHaveBeenCalledWith('other');
    expect(response.body.events[0]).toMatchObject({ id: 'event-1', time: '8:00 AM', allDay: false });
  });

  it('preserves entropy fallback and the existing /:source-before-/status route order', async () => {
    const principalResolver = { resolve: vi.fn(() => 'head') };
    const entropyService = {
      getReport: vi.fn(async () => ({ items: [], summary: {} })),
      getSourceEntropy: vi.fn(async (_username, source) => ({ source, status: 'fresh' })),
    };
    const app = mount('/entropy', createEntropyRouter({ entropyService, principalResolver, logger }));
    expect((await request(app).get('/entropy')).body).toEqual({ items: [], summary: {} });
    const status = await request(app).get('/entropy/status');
    expect(status.body).toEqual({ source: 'status', status: 'fresh' });
    expect(entropyService.getSourceEntropy).toHaveBeenCalledWith('head', 'status');
  });

  it('preserves harvest explicit-user precedence and success envelope', async () => {
    const harvesterService = {
      has: vi.fn(() => true), listHarvesters: vi.fn(() => [{ serviceId: 'demo' }]),
      getAllStatuses: vi.fn(() => []), getStatus: vi.fn(() => ({ serviceId: 'demo' })),
      harvest: vi.fn(async () => ({ collected: 1 })),
    };
    const principalResolver = { resolve: vi.fn(() => 'head') };
    const app = mount('/harvest', createHarvestRouter({ harvesterService, principalResolver, logger }));
    const response = await request(app).post('/harvest/demo?user=query-user&mode=quick')
      .send({ user: 'body-user', force: true });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, harvester: 'demo', data: { collected: 1 } });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(harvesterService.harvest).toHaveBeenCalledWith('demo', 'query-user', { mode: 'quick', force: true });
    expect(principalResolver.resolve).not.toHaveBeenCalled();
  });

  it('preserves lifelog authenticated-user precedence and raw weight envelope', async () => {
    const weightService = { read: vi.fn(() => ({ username: 'alice', data: [{ lbs: 150 }] })) };
    const app = express();
    app.use((req, _res, next) => { req.user = { username: 'alice' }; next(); });
    app.use('/lifelog', createLifelogRouter({ aggregator: {}, weightService }));
    const response = await request(app).get('/lifelog/weight');
    expect(response.body).toEqual([{ lbs: 150 }]);
    expect(weightService.read).toHaveBeenCalledWith('alice');
  });

  it('preserves media surface config envelope and optional household argument', async () => {
    const mediaSurfaceConfig = { get: vi.fn(() => ({ browse: ['movies'], searchScopes: ['all'] })) };
    const app = mount('/media', createMediaRouter({
      mediaSurfaceConfig, mediaQueueService: {}, createMediaQueue: vi.fn(),
      mediaQueueEvents: { changed() {} }, logger,
    }));
    const response = await request(app).get('/media/config?household=other');
    expect(response.body).toEqual({ browse: ['movies'], searchScopes: ['all'] });
    expect(mediaSurfaceConfig.get).toHaveBeenCalledWith('other');
  });
});

describe('explicit application operations at API handlers', () => {
  it('preserves all home-dashboard routes and command arguments', async () => {
    const operations = {
      getConfig: { execute: vi.fn(async () => ({ rooms: [] })) },
      getState: { execute: vi.fn(async () => ({ entities: [] })) },
      getHistory: { execute: vi.fn(async () => ({ series: [] })) },
      toggleEntity: { execute: vi.fn(async (command) => command) },
      activateScene: { execute: vi.fn(async (command) => command) },
    };
    const app = mount('/home', createHomeDashboardRouter({ operations }));
    expect((await request(app).get('/home/config')).body).toEqual({ rooms: [] });
    expect((await request(app).get('/home/state')).body).toEqual({ entities: [] });
    expect((await request(app).get('/home/history?hours=2')).body).toEqual({ series: [] });
    expect((await request(app).post('/home/toggle').send({ entityId: 'light.a', desiredState: 'on' })).body)
      .toEqual({ entityId: 'light.a', desiredState: 'on' });
    expect((await request(app).post('/home/scene/evening')).body).toEqual({ sceneId: 'evening' });
  });

  it('preserves Journalist morning success and unavailable-export precedence', async () => {
    const journalistApi = {
      canExportJournal: vi.fn(() => false),
      resolveUsername: vi.fn((explicit) => explicit || 'head'),
      morning: vi.fn(async () => ({
        kind: 'sent', username: 'alice', date: '2026-08-28',
        delivery: { success: true, messageId: 'm1', fallback: false },
      })),
      trigger: vi.fn(async () => ({ prompted: true })),
    };
    const app = mount('/journalist', createJournalistRouter(journalistApi, { logger }));
    expect((await request(app).get('/journalist/journal?chatId=1')).status).toBe(501);
    const morning = await request(app).get('/journalist/morning?user=alice&date=2026-08-28');
    expect(morning.body).toEqual({
      success: true, username: 'alice', date: '2026-08-28', messageId: 'm1', fallback: false,
    });
  });

  it('preserves Nutribot direct and report envelopes through one semantic service', async () => {
    const nutribotApi = {
      userContext: vi.fn(() => ({ userId: 'alice', conversationId: 'telegram:1' })),
      logUpc: vi.fn(async () => ({ success: true })),
      report: vi.fn(async () => ({ calories: 10 })),
    };
    const app = mount('/nutribot', createNutribotRouter(nutribotApi, { logger }));
    const upc = await request(app).post('/nutribot/upc').send({ upc: '016000275287', user: 'alice' });
    expect(upc.status).toBe(200);
    expect(upc.body).toMatchObject({ ok: true, result: { success: true } });
    expect(nutribotApi.logUpc).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'alice', conversationId: 'telegram:1', upc: '016000275287', messageId: null,
    }));
    expect((await request(app).get('/nutribot/report?chatId=alice')).body)
      .toMatchObject({ ok: true, data: { calories: 10 } });
  });
});
