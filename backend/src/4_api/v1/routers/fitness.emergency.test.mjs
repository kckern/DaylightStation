// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

/**
 * Build an app exercising the emergency-lockdown endpoints with controllable
 * config/profile loading, lockdown use cases, the emergency detector, and a
 * controllable unlock service for the admin-scan routes.
 */
function appWith({
  fitnessConfig = { locks: { emergency: ['alice'] } },
  profiles = { alice: { identities: { fingerprints: [{ id: 'uuid-a' }] } } },
  unlockService,
  triggerEmergencyLockdown,
  releaseEmergencyLockdown,
  getLockdownState,
  emergencyDetector,
} = {}) {
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
    resolveUnlockService: () => unlockService ?? null,
    triggerEmergencyLockdown: triggerEmergencyLockdown ?? null,
    releaseEmergencyLockdown: releaseEmergencyLockdown ?? null,
    getLockdownState: getLockdownState ?? null,
    emergencyDetector: emergencyDetector ?? null,
    logger: silentLogger,
  }));
  return { app, fitnessConfigService, userService };
}

// A unlock service whose scan matches the given verdict.
function scanService(verdict) {
  return {
    requestUnlock: vi.fn().mockResolvedValue(verdict),
    beginForeground: vi.fn(),
    endForeground: vi.fn(),
  };
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
    const emergencyDetector = { consumePendingDetection: vi.fn(() => null) };
    const triggerEmergencyLockdown = { execute: vi.fn() };
    const { app } = appWith({ emergencyDetector, triggerEmergencyLockdown });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'no-pending-detection' });
    expect(triggerEmergencyLockdown.execute).not.toHaveBeenCalled();
  });

  it('triggers lockdown for the pending detection userId', async () => {
    const emergencyDetector = { consumePendingDetection: vi.fn(() => ({ userId: 'alice' })) };
    const triggerEmergencyLockdown = {
      execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'alice' }),
    };
    const { app } = appWith({ emergencyDetector, triggerEmergencyLockdown });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 3600, lockedBy: 'alice' });
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledTimes(1);
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(
      expect.objectContaining({ lockedBy: 'alice' }),
    );
  });

  it('returns 503 when triggerEmergencyLockdown is unwired despite a pending detection', async () => {
    const emergencyDetector = { consumePendingDetection: vi.fn(() => ({ userId: 'alice' })) };
    const { app } = appWith({ emergencyDetector, triggerEmergencyLockdown: null });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'emergency-unavailable' });
  });
});

describe('fitness router — POST /emergency/release', () => {
  it('returns { released:false } when the admin scan does not match', async () => {
    const unlockService = scanService({ matched: false });
    const releaseEmergencyLockdown = { execute: vi.fn() };
    const { app } = appWith({ unlockService, releaseEmergencyLockdown });

    const res = await request(app).post('/emergency/release').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false });
    expect(releaseEmergencyLockdown.execute).not.toHaveBeenCalled();
    expect(unlockService.requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('releases the lockdown when the admin scan matches', async () => {
    const unlockService = scanService({ matched: true, userId: 'alice' });
    const releaseEmergencyLockdown = { execute: vi.fn().mockResolvedValue(undefined) };
    const { app } = appWith({ unlockService, releaseEmergencyLockdown });

    const res = await request(app).post('/emergency/release').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(releaseEmergencyLockdown.execute).toHaveBeenCalledTimes(1);
    expect(releaseEmergencyLockdown.execute).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'alice' }),
    );
    // Foreground arbiter is used around the scan.
    expect(unlockService.beginForeground).toHaveBeenCalledTimes(1);
    expect(unlockService.endForeground).toHaveBeenCalledTimes(1);
  });
});

describe('fitness router — POST /emergency/abort', () => {
  it('returns { confirmed:true } when the admin scan matches', async () => {
    const unlockService = scanService({ matched: true, userId: 'alice' });
    const { app } = appWith({ unlockService });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: true });
    expect(unlockService.requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('returns { confirmed:false } when the admin scan does not match', async () => {
    const unlockService = scanService({ matched: false });
    const { app } = appWith({ unlockService });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: false });
  });
});
