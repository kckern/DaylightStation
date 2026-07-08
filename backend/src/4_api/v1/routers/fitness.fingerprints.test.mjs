// backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silent = { info(){}, warn(){}, error(){}, debug(){} };

function appWith({ profiles = {}, primary, admin, unlockService, manageService, identityRelay } = {}) {
  const userService = {
    getProfile: (u) => profiles[u] ?? null,
    getAllProfiles: () => new Map(Object.entries(profiles)),
  };
  const configService = { getDefaultHouseholdId: () => 'default' };
  const fitnessConfigService = {
    loadRawConfig: () => ({ users: { primary: primary ?? Object.keys(profiles), admin: admin ?? [] } }),
  };
  const writes = [];
  const fingerprintProfileWriter = {
    addFingerprint: vi.fn(async (u, e) => { writes.push(['add', u, e]); }),
    removeFingerprint: vi.fn(async (u, id) => { writes.push(['remove', u, id]); }),
  };
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({
    userService, configService, fitnessConfigService, fingerprintProfileWriter,
    resolveUnlockService: () => unlockService ?? null,
    resolveManageService: () => manageService ?? null,
    identityRelay: identityRelay ?? null,
    logger: silent,
  }));
  return { app, fingerprintProfileWriter, writes };
}

const fp = (id, finger = 'right-index') => ({ id, finger, enrolled: '2026-06-17' });

describe('GET /fingerprints', () => {
  it('lists only eligible (primary) users with admin flag and fingers but never uuids', async () => {
    const { app } = appWith({
      profiles: {
        'admin-user': { display_name: 'Admin', identities: { admin: true, fingerprints: [fp('a1','left-thumb')] } },
        'test-user': { identities: { fingerprints: [] } },
        'family-user': { display_name: 'Fam', identities: { fingerprints: [fp('f1')] } },
      },
      primary: ['admin-user', 'test-user'],
    });
    const res = await request(app).get('/fingerprints');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.find((u) => u.username === 'family-user')).toBeUndefined();
    const admin = res.body.find((u) => u.username === 'admin-user');
    expect(admin).toMatchObject({ displayName: 'Admin', admin: true, fingerprints: [{ finger: 'left-thumb', enrolled: '2026-06-17' }] });
    expect(JSON.stringify(res.body)).not.toContain('a1');
    expect(res.body.find((u) => u.username === 'test-user')).toMatchObject({ admin: false, fingerprints: [] });
  });

  it('merges config admins with primary, admins first, deduped, and flags them admin', async () => {
    const { app } = appWith({
      profiles: {
        user_1: { display_name: 'KC', identities: { fingerprints: [fp('k1')] } },
        user_9: { display_name: 'User_9', identities: { fingerprints: [] } },
        user_2: { display_name: 'User_2', identities: { fingerprints: [] } },
      },
      primary: ['user_1', 'user_2'],
      admin: ['user_1', 'user_9'], // user_9 is admin-only (not primary); user_1 is in both
    });
    const res = await request(app).get('/fingerprints');
    expect(res.status).toBe(200);
    // admins first (user_1, user_9), then remaining primary (user_2); user_1 not duplicated
    expect(res.body.map((u) => u.username)).toEqual(['user_1', 'user_9', 'user_2']);
    expect(res.body.find((u) => u.username === 'user_9')).toMatchObject({ displayName: 'User_9', admin: true });
    expect(res.body.find((u) => u.username === 'user_1')).toMatchObject({ admin: true });
    expect(res.body.find((u) => u.username === 'user_2')).toMatchObject({ admin: false });
  });

  it('hides simulated fixtures so they never show as phantom duplicate fingers', async () => {
    const { app } = appWith({
      profiles: {
        user_1: {
          display_name: 'KC',
          identities: {
            fingerprints: [
              { id: 'sim-kckern-0001', finger: 'right-index', enrolled: '2026-06-17', simulated: true },
              fp('real-1', 'right-index'),
              fp('real-2', 'right-thumb'),
            ],
          },
        },
      },
      primary: ['user_1'],
    });
    const res = await request(app).get('/fingerprints');
    const kc = res.body.find((u) => u.username === 'user_1');
    // Only the two REAL prints — one right-index, no duplicate, no sim uuid leaked.
    expect(kc.fingerprints).toHaveLength(2);
    expect(kc.fingerprints.filter((f) => f.finger === 'right-index')).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('sim-kckern-0001');
  });
});

describe('DELETE /fingerprints with a simulated fixture present', () => {
  it('deletes the real finger without 409 ambiguity from the colliding sim entry', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'user_1' });
    const requestDelete = vi.fn().mockResolvedValue({ success: true });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: {
        user_1: {
          identities: {
            fingerprints: [
              { id: 'sim-kckern-0001', finger: 'right-index', enrolled: '2026-06-17', simulated: true },
              fp('real-1', 'right-index'),
            ],
          },
        },
      },
      primary: ['user_1'],
      unlockService: { requestUnlock },
      manageService: { requestDelete },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'user_1', finger: 'right-index' });
    expect(res.status).toBe(200);
    expect(requestDelete).toHaveBeenCalledWith({ uuid: 'real-1' });
    expect(fingerprintProfileWriter.removeFingerprint).toHaveBeenCalledWith('user_1', 'real-1');
  });
});

describe('admin eligibility (config admin, not primary)', () => {
  it('a config admin who is not primary can still enroll (TOFU)', async () => {
    const requestEnroll = vi.fn().mockResolvedValue({ success: true, uuid: 'e-uuid' });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: { user_9: { display_name: 'User_9', identities: { fingerprints: [] } } },
      primary: [],
      admin: ['user_9'],
      unlockService: { requestUnlock: vi.fn() },
      manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'user_9', finger: 'right-index' });
    expect(res.status).toBe(200);
    expect(requestEnroll).toHaveBeenCalled();
    expect(fingerprintProfileWriter.addFingerprint).toHaveBeenCalledWith('user_9', expect.objectContaining({ id: 'e-uuid', finger: 'right-index' }));
  });
});

describe('POST /fingerprints/enroll', () => {
  it('unenrolled user enrolls with NO auth scan, then writes the profile', async () => {
    const requestUnlock = vi.fn();
    const requestEnroll = vi.fn().mockResolvedValue({ success: true, uuid: 'new-uuid' });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [] } } },
      unlockService: { requestUnlock },
      manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'right-index', clientToken: 'tok-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, finger: 'right-index' });
    expect(requestUnlock).not.toHaveBeenCalled();
    expect(requestEnroll).toHaveBeenCalledWith({ finger: 'right-index', username: 'test-user', clientToken: 'tok-1' });
    expect(fingerprintProfileWriter.addFingerprint).toHaveBeenCalledWith('test-user', expect.objectContaining({ id: 'new-uuid', finger: 'right-index' }));
  });

  it('enrolled user must pass auth first (identify against gallery)', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'test-user' });
    const requestEnroll = vi.fn().mockResolvedValue({ success: true, uuid: 'new-uuid' });
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock }, manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'left-thumb', clientToken: 't' });
    expect(res.status).toBe(200);
    expect(requestUnlock).toHaveBeenCalledWith('manage:test-user', [{ uuid: 'own-1', username: 'test-user' }]);
    expect(requestEnroll).toHaveBeenCalled();
  });

  it('enrolled user with a denied scan → 403 auth-denied, no enroll', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: false });
    const requestEnroll = vi.fn();
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock }, manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'left-thumb' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'auth-denied' });
    expect(requestEnroll).not.toHaveBeenCalled();
  });

  it('non-eligible (non-primary) user → 403 not-eligible, no enroll', async () => {
    const requestEnroll = vi.fn();
    const { app } = appWith({
      profiles: { 'family-user': { identities: { fingerprints: [] } } },
      primary: [],
      manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'family-user', finger: 'right-index' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'not-eligible' });
    expect(requestEnroll).not.toHaveBeenCalled();
  });

  it('duplicate finger on the same user → 409 finger-taken, no enroll', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'test-user' });
    const requestEnroll = vi.fn();
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1', 'right-index')] } } },
      unlockService: { requestUnlock }, manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'right-index' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'finger-taken' });
    expect(requestEnroll).not.toHaveBeenCalled();
  });

  it('unknown user → 400', async () => {
    const { app } = appWith({ profiles: {}, manageService: { requestEnroll: vi.fn() } });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'ghost', finger: 'right-index' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-user' });
  });
});

describe('DELETE /fingerprints', () => {
  it('requires auth, resolves finger→uuid, deletes the template, then removes the profile entry', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'admin-user' });
    const requestDelete = vi.fn().mockResolvedValue({ success: true });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: {
        'test-user': { identities: { fingerprints: [fp('own-1', 'right-index')] } },
        'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
      },
      unlockService: { requestUnlock }, manageService: { requestDelete },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', finger: 'right-index' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(requestDelete).toHaveBeenCalledWith({ uuid: 'own-1' });
    expect(fingerprintProfileWriter.removeFingerprint).toHaveBeenCalledWith('test-user', 'own-1');
  });

  it('an active admin session authorizes delete without a second scan', async () => {
    const requestUnlock = vi.fn();
    const requestDelete = vi.fn().mockResolvedValue({ success: true });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1', 'right-index')] } } },
      unlockService: { requestUnlock },
      manageService: { requestDelete },
      identityRelay: { adminVerifiedWithin: () => ({ userId: 'user_1' }) },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', finger: 'right-index' });
    expect(res.status).toBe(200);
    // The admin-gate scan stood in — no second verify scan was requested.
    expect(requestUnlock).not.toHaveBeenCalled();
    expect(requestDelete).toHaveBeenCalledWith({ uuid: 'own-1' });
    expect(fingerprintProfileWriter.removeFingerprint).toHaveBeenCalledWith('test-user', 'own-1');
  });

  it('rejects deleting a finger the user does not have → 400 unknown-fingerprint', async () => {
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1', 'right-index')] } } },
      unlockService: { requestUnlock: vi.fn() }, manageService: { requestDelete: vi.fn() },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', finger: 'left-thumb' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-fingerprint' });
  });

  it('enrolled user with a denied scan → 403 auth-denied, no delete', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: false });
    const requestDelete = vi.fn();
    const { app, fingerprintProfileWriter } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1', 'right-index')] } } },
      unlockService: { requestUnlock }, manageService: { requestDelete },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', finger: 'right-index' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'auth-denied' });
    expect(requestDelete).not.toHaveBeenCalled();
    expect(fingerprintProfileWriter.removeFingerprint).not.toHaveBeenCalled();
  });
});
