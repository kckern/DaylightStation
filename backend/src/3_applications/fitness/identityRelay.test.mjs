import { describe, it, expect } from 'vitest';
import {
  createIdentityRelay,
  buildFingerprintIdentityIndex,
  buildAuthz,
  EMERGENCY_LOCK,
  ADMIN_LOCK,
} from './identityRelay.mjs';

const profiles = () => new Map([
  ['kc', { identities: { fingerprints: [{ id: 'uuid-kc', finger: 'right-index' }] } }],
  ['guest', { identities: { fingerprints: [{ id: 'uuid-guest', finger: 'left-thumb' }] } }],
]);
const fitnessConfig = () => ({ locks: { emergency: ['kc'], dance_party: ['kc', 'guest'] } });

function makeBus() {
  let handler = null;
  return {
    broadcasts: [],
    broadcast(topic, payload) { this.broadcasts.push({ topic, payload }); },
    onClientMessage(fn) { handler = fn; },
    deliver(message) { handler('client-1', message); },
  };
}

describe('buildFingerprintIdentityIndex', () => {
  it('maps every enrolled uuid to its user + finger', () => {
    const idx = buildFingerprintIdentityIndex(profiles());
    expect(idx['uuid-kc']).toEqual({ userId: 'kc', finger: 'right-index' });
    expect(idx['uuid-guest']).toEqual({ userId: 'guest', finger: 'left-thumb' });
  });
});

describe('buildAuthz', () => {
  it('collects all lock memberships and flags emergency', () => {
    expect(buildAuthz('kc', fitnessConfig())).toEqual({ emergency: true, locks: ['emergency', 'dance_party'] });
    expect(buildAuthz('guest', fitnessConfig())).toEqual({ emergency: false, locks: ['dance_party'] });
  });
  it('EMERGENCY_LOCK is the canonical emergency lock id', () => {
    expect(EMERGENCY_LOCK).toBe('emergency');
  });
  it('grants the ADMIN_LOCK to fitness.yml admins (in sync, not hand-listed)', () => {
    const cfg = { locks: { dance_party: ['kc'] }, users: { admin: ['kc', 'elizabeth'] } };
    expect(ADMIN_LOCK).toBe('admin');
    expect(buildAuthz('kc', cfg).locks).toEqual(['dance_party', 'admin']);
    // elizabeth is admin-only (no lock-map membership) but still gets the admin lock.
    expect(buildAuthz('elizabeth', cfg).locks).toEqual(['admin']);
    // a non-admin gets no admin lock.
    expect(buildAuthz('guest', cfg).locks).toEqual([]);
  });
});

describe('createIdentityRelay', () => {
  const deps = (now) => ({
    eventBus: makeBus(),
    userService: { getAllProfiles: () => profiles() },
    loadFitnessConfig: () => fitnessConfig(),
    now,
    logger: { debug() {}, info() {}, warn() {} },
  });

  it('enriches a matched scan into fitness.identity.detected', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', modality: 'fingerprint', matched: true, uuid: 'uuid-guest' });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload).toEqual({
      modality: 'fingerprint', matched: true, userId: 'guest', finger: 'left-thumb',
      authz: { emergency: false, locks: ['dance_party'] }, at: 1000,
    });
    expect(relay.consumePendingDetection(1000)).toBeNull();
  });

  it('stamps an admin session on an admin scan (not a non-admin), and expires after the TTL', () => {
    let t = 1000;
    const d = {
      eventBus: makeBus(),
      userService: { getAllProfiles: () => profiles() },
      loadFitnessConfig: () => ({ locks: {}, users: { admin: ['kc'] } }),
      now: () => t,
      adminSessionTtlMs: 5000,
      logger: { debug() {}, info() {}, warn() {} },
    };
    const relay = createIdentityRelay(d);
    // A non-admin scan does NOT open an admin session.
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-guest' });
    expect(relay.adminVerifiedWithin()).toBeNull();
    // An admin scan opens it.
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.adminVerifiedWithin()).toMatchObject({ userId: 'kc' });
    // Still valid within the window…
    t = 1000 + 4000;
    expect(relay.adminVerifiedWithin()).toMatchObject({ userId: 'kc' });
    // …expired past it.
    t = 1000 + 6000;
    expect(relay.adminVerifiedWithin()).toBeNull();
  });

  it('unknown uuid → matched:false null identity', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'nope' });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload.matched).toBe(false);
    expect(evt.payload.userId).toBeNull();
  });

  it('sensed-but-unrecognized scan → matched:false', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', matched: false });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload.matched).toBe(false);
  });

  it('stamps a pending detection for an emergency-authorized identity, consumable once within TTL', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.consumePendingDetection(5000)).toEqual({ userId: 'kc', at: 1000 });
    expect(relay.consumePendingDetection(5000)).toBeNull();
  });

  it('pending detection expires after TTL', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.consumePendingDetection(1000 + 30001)).toBeNull();
  });

  it('ignores non-biometric.scan messages', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'something.else', matched: true, uuid: 'uuid-kc' });
    expect(d.eventBus.broadcasts).toHaveLength(0);
  });
});
