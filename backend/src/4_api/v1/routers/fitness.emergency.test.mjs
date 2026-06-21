// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

/**
 * Build an app exercising the emergency-lockdown endpoints with controllable
 * lockdown use cases and an injected fake identityRelay. The emergency
 * endpoints consume a short-lived pending detection from identityRelay
 * (via consumePendingDetection(Date.now())) rather than scanning themselves.
 */
function appWith({
  triggerEmergencyLockdown,
  releaseEmergencyLockdown,
  getLockdownState,
  identityRelay,
} = {}) {
  const fitnessConfigService = {
    loadRawConfig: vi.fn(() => ({ locks: { emergency: ['alice'] } })),
  };
  const userService = {
    getProfile: vi.fn(() => null),
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
    triggerEmergencyLockdown: triggerEmergencyLockdown ?? null,
    releaseEmergencyLockdown: releaseEmergencyLockdown ?? null,
    getLockdownState: getLockdownState ?? null,
    identityRelay: identityRelay ?? null,
    logger: silentLogger,
  }));
  return { app, fitnessConfigService, userService };
}

// A fake identityRelay whose consumePendingDetection yields the given pending
// detection (or null for no-pending).
function relayWith(pending) {
  return { consumePendingDetection: vi.fn(() => pending) };
}

describe('fitness router — GET /emergency', () => {
  it('returns { locked:false } when no lockdown state', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue(null) };
    const { app } = appWith({ getLockdownState });

    const res = await request(app).get('/emergency');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: false });
    expect(getLockdownState.execute).toHaveBeenCalledTimes(1);
  });

  it('returns { locked:true, lockedUntil, lockedBy } when locked', async () => {
    const getLockdownState = {
      execute: vi.fn().mockResolvedValue({ lockedUntil: 2800, lockedBy: 'alice' }),
    };
    const { app } = appWith({ getLockdownState });

    const res = await request(app).get('/emergency');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 2800, lockedBy: 'alice' });
  });

  it('returns { locked:false } when getLockdownState is unwired', async () => {
    const { app } = appWith({ getLockdownState: null });

    const res = await request(app).get('/emergency');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: false });
  });
});

describe('fitness router — POST /emergency/commit', () => {
  it('returns 409 no-pending-detection when no detection is pending', async () => {
    const identityRelay = relayWith(null);
    const triggerEmergencyLockdown = { execute: vi.fn() };
    const { app } = appWith({ identityRelay, triggerEmergencyLockdown });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'no-pending-detection' });
    expect(identityRelay.consumePendingDetection).toHaveBeenCalledTimes(1);
    expect(triggerEmergencyLockdown.execute).not.toHaveBeenCalled();
  });

  it('triggers lockdown for the pending detection userId', async () => {
    const identityRelay = relayWith({ userId: 'alice', at: 123 });
    const triggerEmergencyLockdown = {
      execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'alice' }),
    };
    const { app } = appWith({ identityRelay, triggerEmergencyLockdown });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 3600, lockedBy: 'alice' });
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledTimes(1);
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(
      expect.objectContaining({ lockedBy: 'alice' }),
    );
  });

  it('returns 503 when triggerEmergencyLockdown is unwired despite a pending detection', async () => {
    const identityRelay = relayWith({ userId: 'alice', at: 123 });
    const { app } = appWith({ identityRelay, triggerEmergencyLockdown: null });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'emergency-unavailable' });
  });

  it('is idempotent: returns the current lock state without re-triggering when already locked', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue({ lockedUntil: 5000, lockedBy: 'abuse-protection' }) };
    const triggerEmergencyLockdown = { execute: vi.fn() };
    const identityRelay = { consumeArmedCommit: vi.fn(), consumePendingDetection: vi.fn() };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 5000, lockedBy: 'abuse-protection' });
    expect(triggerEmergencyLockdown.execute).not.toHaveBeenCalled();
    expect(identityRelay.consumeArmedCommit).not.toHaveBeenCalled();
  });

  it('commits an armed abuse token when present (does not touch pending)', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue(null) };
    const triggerEmergencyLockdown = { execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'abuse-protection' }) };
    const identityRelay = {
      consumeArmedCommit: vi.fn(() => ({ userId: 'abuse-protection', at: 1 })),
      consumePendingDetection: vi.fn(),
    };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 3600, lockedBy: 'abuse-protection' });
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(expect.objectContaining({ lockedBy: 'abuse-protection' }));
    expect(identityRelay.consumePendingDetection).not.toHaveBeenCalled();
  });

  it('falls back to a generously-aged pending detection (admin press)', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue(null) };
    const triggerEmergencyLockdown = { execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'alice' }) };
    const identityRelay = {
      consumeArmedCommit: vi.fn(() => null),
      consumePendingDetection: vi.fn(() => ({ userId: 'alice', at: 1 })),
    };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(identityRelay.consumePendingDetection).toHaveBeenCalledWith(expect.any(Number), 120000);
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(expect.objectContaining({ lockedBy: 'alice' }));
  });
});

describe('fitness router — POST /emergency/abort', () => {
  it('returns { confirmed:true } when a detection is pending', async () => {
    const identityRelay = relayWith({ userId: 'alice', at: 123 });
    const { app } = appWith({ identityRelay });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: true });
    expect(identityRelay.consumePendingDetection).toHaveBeenCalledTimes(1);
  });

  it('returns { confirmed:false } when no detection is pending', async () => {
    const identityRelay = relayWith(null);
    const { app } = appWith({ identityRelay });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: false });
  });
});

describe('fitness router — POST /emergency/release', () => {
  it('releases the lockdown when a detection is pending', async () => {
    const identityRelay = relayWith({ userId: 'alice', at: 123 });
    const releaseEmergencyLockdown = { execute: vi.fn().mockResolvedValue(undefined) };
    const { app } = appWith({ identityRelay, releaseEmergencyLockdown });

    const res = await request(app).post('/emergency/release').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(releaseEmergencyLockdown.execute).toHaveBeenCalledTimes(1);
    expect(releaseEmergencyLockdown.execute).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'alice' }),
    );
  });

  it('returns { released:false } and does not release when no detection is pending', async () => {
    const identityRelay = relayWith(null);
    const releaseEmergencyLockdown = { execute: vi.fn() };
    const { app } = appWith({ identityRelay, releaseEmergencyLockdown });

    const res = await request(app).post('/emergency/release').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false });
    expect(releaseEmergencyLockdown.execute).not.toHaveBeenCalled();
  });
});
