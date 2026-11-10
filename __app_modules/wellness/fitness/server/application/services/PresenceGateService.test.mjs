// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PresenceGateService, normalizePresenceGateConfig } from './PresenceGateService.mjs';
import { createFitnessRouter } from '../../api/fitness.mjs';

const ENTITY = 'binary_sensor.adult_home';
const enabledConfig = (extra = {}) => ({ presence_gate: { enabled: true, entity: ENTITY, ...extra } });
const gatewayReturning = (state) => ({ getState: vi.fn(async () => (state === undefined ? null : { entityId: ENTITY, state })) });

describe('normalizePresenceGateConfig', () => {
  it('is off with no block, with enabled:false, or with no entity', () => {
    expect(normalizePresenceGateConfig(undefined).enabled).toBe(false);
    expect(normalizePresenceGateConfig({ enabled: false, entity: ENTITY }).enabled).toBe(false);
    expect(normalizePresenceGateConfig({ enabled: true }).enabled).toBe(false);
  });

  it('defaults gate to play+show, 30s cache, 30 min unlock; drops unknown gate kinds', () => {
    const cfg = normalizePresenceGateConfig({ enabled: true, entity: ENTITY });
    expect(cfg).toMatchObject({ enabled: true, entity: ENTITY, cacheMs: 30000, gate: ['play', 'show'], unlockMinutes: 30 });
    expect(normalizePresenceGateConfig({ enabled: true, entity: ENTITY, gate: ['show', 'bogus'] }).gate).toEqual(['show']);
  });
});

describe('PresenceGateService.status', () => {
  it('no config → disabled and Home Assistant is never queried', async () => {
    const gateway = gatewayReturning('on');
    const svc = new PresenceGateService({ gateway, loadConfig: () => ({}) });
    expect(await svc.status()).toEqual({ enabled: false });
    const off = new PresenceGateService({ gateway, loadConfig: () => ({ presence_gate: { enabled: false, entity: ENTITY } }) });
    expect(await off.status()).toEqual({ enabled: false });
    expect(gateway.getState).not.toHaveBeenCalled();
  });

  it('on → home', async () => {
    const gateway = gatewayReturning('on');
    const res = await new PresenceGateService({ gateway, loadConfig: () => enabledConfig() }).status();
    expect(res).toMatchObject({ enabled: true, home: true, state: 'on', reason: null, gate: ['play', 'show'] });
    expect(gateway.getState).toHaveBeenCalledWith(ENTITY);
  });

  it('off → away', async () => {
    const res = await new PresenceGateService({ gateway: gatewayReturning('off'), loadConfig: () => enabledConfig() }).status();
    expect(res).toMatchObject({ home: false, state: 'off', reason: null });
  });

  it.each([['unknown'], ['unavailable']])('%s → away (fail closed)', async (state) => {
    const res = await new PresenceGateService({ gateway: gatewayReturning(state), loadConfig: () => enabledConfig() }).status();
    expect(res).toMatchObject({ home: false, state, reason: 'unavailable' });
  });

  it('unreadable entity, a throwing gateway, or no gateway → away', async () => {
    const unreadable = await new PresenceGateService({ gateway: gatewayReturning(undefined), loadConfig: () => enabledConfig() }).status();
    expect(unreadable).toMatchObject({ home: false, reason: 'unreadable' });
    const throwing = { getState: vi.fn(async () => { throw new Error('boom'); }) };
    expect(await new PresenceGateService({ gateway: throwing, loadConfig: () => enabledConfig() }).status())
      .toMatchObject({ home: false, reason: 'error' });
    expect(await new PresenceGateService({ gateway: null, loadConfig: () => enabledConfig() }).status())
      .toMatchObject({ home: false, reason: 'no_gateway' });
  });

  it('caches one read per cache window, then re-reads', async () => {
    let t = 1000;
    const gateway = gatewayReturning('on');
    const svc = new PresenceGateService({ gateway, loadConfig: () => enabledConfig({ cache_seconds: 30 }), now: () => t });
    expect((await svc.status()).cached).toBe(false);
    t += 29000;
    expect((await svc.status()).cached).toBe(true);
    expect(gateway.getState).toHaveBeenCalledTimes(1);
    t += 2000;
    expect((await svc.status()).cached).toBe(false);
    expect(gateway.getState).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers share one in-flight read', async () => {
    const gateway = gatewayReturning('off');
    const svc = new PresenceGateService({ gateway, loadConfig: () => enabledConfig() });
    await Promise.all([svc.status(), svc.status(), svc.status()]);
    expect(gateway.getState).toHaveBeenCalledTimes(1);
  });
});

describe('GET /presence', () => {
  const appWith = (presenceGate) => {
    const app = express();
    app.use('/', createFitnessRouter({ presenceGate, logger: { info() {}, warn() {}, error() {} } }));
    return app;
  };

  it('reports the service verdict, uncached by the browser', async () => {
    const svc = new PresenceGateService({ gateway: gatewayReturning('off'), loadConfig: () => enabledConfig() });
    const res = await request(appWith(svc)).get('/presence');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ enabled: true, home: false, state: 'off' });
  });

  it('reports disabled when no service is wired', async () => {
    const res = await request(appWith(null)).get('/presence');
    expect(res.body).toEqual({ enabled: false });
  });
});
