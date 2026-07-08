// tests/unit/applications/fitness/manageAccessEligibility.test.mjs
//
// Task P2.4 sub-task B (audit API-3): the fitness god-router's fingerprint /
// manage-access AUTHORIZATION subsystem (eligibility policy + the self/admin
// identify gate) moved into the application layer. This suite pins:
//
//   1. resolveEligibleUsernames — the "which users may enroll fingerprints"
//      rule (admins first, then primary, deduped, blanks skipped), derived from
//      the original router's eligibleUsernames() helper.
//   2. ManageAccess.gate — the security gate decision that guards enroll/delete,
//      exercising every branch (TOFU, admin-session bypass, unlock-service
//      missing, reader error, no-match denial, matched grant).
//
// These are SECURITY-load-bearing rules; the expectations are transcribed from
// the pre-refactor router behavior so a regression flips a test.
import { describe, it, expect, vi } from 'vitest';
import { resolveEligibleUsernames } from '#apps/fitness/manageAccessPolicy.mjs';
import { ManageAccess } from '#apps/fitness/usecases/ManageAccess.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('resolveEligibleUsernames (enrollment eligibility policy)', () => {
  it('lists admins first, then primary, deduped when a user is in both', () => {
    const cfg = { users: { admin: ['user_1', 'user_9'], primary: ['user_1', 'user_2'] } };
    // admins first (user_1, user_9), then remaining primary (user_2); user_1 once.
    expect(resolveEligibleUsernames(cfg)).toEqual(['user_1', 'user_9', 'user_2']);
  });

  it('includes an admin who is not primary', () => {
    const cfg = { users: { admin: ['user_9'], primary: [] } };
    expect(resolveEligibleUsernames(cfg)).toEqual(['user_9']);
  });

  it('skips falsy / blank usernames', () => {
    const cfg = { users: { admin: ['', null], primary: ['user_2', undefined] } };
    expect(resolveEligibleUsernames(cfg)).toEqual(['user_2']);
  });

  it('returns [] when no users configured', () => {
    expect(resolveEligibleUsernames({})).toEqual([]);
    expect(resolveEligibleUsernames(null)).toEqual([]);
  });
});

// Build a ManageAccess wired against in-memory fakes for the gate tests.
function buildManageAccess({ profiles = {}, admin = [], primary, unlockService, identityRelay } = {}) {
  const userService = {
    getProfile: (u) => profiles[u] ?? null,
    getAllProfiles: () => new Map(Object.entries(profiles)),
  };
  const fitnessConfigService = {
    loadRawConfig: () => ({ users: { admin, primary: primary ?? Object.keys(profiles) } }),
  };
  return new ManageAccess({
    userService,
    fitnessConfigService,
    identityRelay: identityRelay ?? null,
    resolveUnlockService: () => unlockService ?? null,
    resolveManageService: () => null,
    logger: silent,
  });
}

const fp = (id, finger = 'right-index') => ({ id, finger, enrolled: '2026-06-17' });

describe('ManageAccess.gate (self/admin authorization gate)', () => {
  it('TOFU: an unenrolled target requires NO auth scan', async () => {
    const requestUnlock = vi.fn();
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [] } } },
      unlockService: { requestUnlock },
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: true });
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('an active admin session authorizes without a scan', async () => {
    const requestUnlock = vi.fn();
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock },
      identityRelay: { adminVerifiedWithin: () => ({ userId: 'user_1' }) },
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: true });
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('enrolled target with no unlock service → 503 unlock-service-unavailable', async () => {
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: null,
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: false, status: 503, body: { error: 'unlock-service-unavailable' } });
  });

  it('enrolled target scans against the target-plus-admin gallery and is granted on match', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'test-user' });
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock },
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: true });
    expect(requestUnlock).toHaveBeenCalledWith('manage:test-user', [{ uuid: 'own-1', username: 'test-user' }]);
  });

  it('a denied scan → 403 auth-denied', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: false });
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock },
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: false, status: 403, body: { error: 'auth-denied' } });
  });

  it('a reader error → 500 auth-failed (never silently grants)', async () => {
    const requestUnlock = vi.fn().mockRejectedValue(new Error('reader offline'));
    const ma = buildManageAccess({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock },
    });
    const gate = await ma.gate('default', 'test-user');
    expect(gate).toEqual({ ok: false, status: 500, body: { error: 'auth-failed' } });
  });

  it("gallery includes every admin's prints so an admin can authorize managing another user", async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'admin-user' });
    const ma = buildManageAccess({
      profiles: {
        'test-user': { identities: { fingerprints: [fp('own-1')] } },
        'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1', 'left-thumb')] } },
      },
      admin: ['admin-user'],
      unlockService: { requestUnlock },
    });
    await ma.gate('default', 'test-user');
    const [, gallery] = requestUnlock.mock.calls[0];
    expect(gallery).toEqual([
      { uuid: 'own-1', username: 'test-user' },
      { uuid: 'adm-1', username: 'admin-user' },
    ]);
  });
});
