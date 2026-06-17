// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

/**
 * Build an app exercising POST /unlock with controllable config/profile loading
 * and a controllable unlock service.
 *
 * @param {object} opts
 * @param {object} opts.fitnessConfig - raw fitness config (with a `locks` map)
 * @param {object} opts.profiles - username -> profile (with identities.fingerprints)
 * @param {object|null|undefined} opts.unlockService - injected service. `undefined`
 *   means "not provided" → router falls back to getUnlockService() (we pass null
 *   factory to simulate unavailable). `null` explicitly simulates unavailable.
 */
function appWith({ fitnessConfig = {}, profiles = {}, unlockService } = {}) {
  const fitnessConfigService = {
    loadRawConfig: vi.fn(() => fitnessConfig),
  };
  const userService = {
    getProfile: vi.fn((username) => profiles[username] ?? null),
  };
  const configService = {
    getDefaultHouseholdId: () => 'default',
  };

  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({
    fitnessConfigService,
    userService,
    configService,
    // resolveUnlockService is the test seam: returns the service (or null).
    resolveUnlockService: () => unlockService ?? null,
    logger: silentLogger,
  }));
  return { app, fitnessConfigService, userService };
}

describe('fitness router — POST /unlock', () => {
  it('resolves candidates and returns the service verdict on a known lock', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'test-user' });
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: {
        'test-user': { identities: { fingerprints: [{ id: 'uuid-1', finger: 'index', enrolled: true }] } },
      },
      unlockService: { requestUnlock },
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: true, userId: 'test-user' });
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestUnlock).toHaveBeenCalledWith('dance_party', [
      { uuid: 'uuid-1', username: 'test-user' },
    ]);
  });

  it('includes reason from the service (e.g. timeout) in the response', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: false, reason: 'timeout' });
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: {
        'test-user': { identities: { fingerprints: [{ id: 'uuid-1' }] } },
      },
      unlockService: { requestUnlock },
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matched: false, reason: 'timeout' });
  });

  it('returns 400 for an unknown lock without scanning', async () => {
    const requestUnlock = vi.fn();
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      unlockService: { requestUnlock },
    });

    const res = await request(app).post('/unlock').send({ lock: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-lock' });
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('returns 400 when lock is missing from the body', async () => {
    const requestUnlock = vi.fn();
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      unlockService: { requestUnlock },
    });

    const res = await request(app).post('/unlock').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-lock' });
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('returns matched:false / no-enrolled-users without calling the service', async () => {
    const requestUnlock = vi.fn();
    const { app } = appWith({
      // Lock exists, authorized user has no enrolled fingerprints.
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: { 'test-user': { identities: { fingerprints: [] } } },
      unlockService: { requestUnlock },
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: false, reason: 'no-enrolled-users' });
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('returns 503 when the unlock service is unavailable', async () => {
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: { 'test-user': { identities: { fingerprints: [{ id: 'uuid-1' }] } } },
      unlockService: null,
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'unlock-service-unavailable' });
  });
});
