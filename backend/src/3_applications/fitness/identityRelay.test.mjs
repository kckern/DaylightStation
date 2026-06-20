import { describe, it, expect } from 'vitest';
import {
  createIdentityRelay,
  buildFingerprintIdentityIndex,
  buildAuthz,
  ADMIN_LOCK,
} from './identityRelay.mjs';

const profiles = () => new Map([
  ['kc', { identities: { fingerprints: [{ id: 'uuid-kc', finger: 'right-index' }] } }],
  ['guest', { identities: { fingerprints: [{ id: 'uuid-guest', finger: 'left-thumb' }] } }],
]);
// kc is an admin (emergency arming requires recognized + admin); guest is not.
const fitnessConfig = () => ({ locks: { emergency: ['kc'], dance_party: ['kc', 'guest'] }, users: { admin: ['kc'] } });

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
  it('collects all lock memberships and flags admin', () => {
    expect(buildAuthz('kc', fitnessConfig())).toEqual({ admin: true, locks: ['emergency', 'dance_party', 'admin'] });
    expect(buildAuthz('guest', fitnessConfig())).toEqual({ admin: false, locks: ['dance_party'] });
  });

  it('admin IS the emergency authority — a non-admin in a config lock list is not admin', () => {
    // sitter is listed in a lock group but is NOT an admin → admin must be false,
    // so they cannot arm/abort/release the emergency shutdown.
    const cfg = { locks: { emergency: ['kc', 'sitter'] }, users: { admin: ['kc'] } };
    expect(buildAuthz('kc', cfg)).toEqual({ admin: true, locks: ['emergency', 'admin'] });
    expect(buildAuthz('sitter', cfg)).toEqual({ admin: false, locks: ['emergency'] });
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
      authz: { admin: false, locks: ['dance_party'] }, at: 1000,
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

  it('stamps a pending detection for an admin identity, consumable once within TTL', () => {
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

describe('scanner-abuse auto-lockdown', () => {
  // kc = admin (holds ADMIN_LOCK); guest = holds dance_party. Both are "safe".
  const abuseDeps = (now, overrides = {}) => ({
    eventBus: makeBus(),
    userService: { getAllProfiles: () => profiles() },
    loadFitnessConfig: () => ({
      locks: { dance_party: ['kc', 'guest'] },
      users: { admin: ['kc'] },
      emergency: { abuse: { enabled: true, threshold: 3, window_sec: 30 } },
    }),
    now,
    logger: { debug() {}, info() {}, warn() {} },
    ...overrides,
  });
  const fail = (bus) => bus.deliver({ topic: 'biometric.scan', matched: false });

  it('trips the ceremony after N unrecognized scans within the window', () => {
    let t = 1000;
    const d = abuseDeps(() => t);
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    t = 3000; fail(d.eventBus);
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony');
    expect(evt).toBeDefined();
    expect(evt.payload).toMatchObject({ reason: 'abuse', count: 3, windowSec: 30 });
    // A synthetic pending is stamped so the existing ceremony→commit path can lock.
    expect(relay.consumePendingDetection(3000)).toEqual({ userId: 'abuse-protection', at: 3000 });
  });

  it('does not trip when failures fall outside the window', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 32000; fail(d.eventBus); // prunes the two >30s-old entries; only 1 in window
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('an authorized scan resets the streak', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 2500; d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-guest' }); // holds dance_party → safe
    t = 3000; fail(d.eventBus);
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('counts a recognized identity holding no locks as a failed scan', () => {
    let t = 0;
    const d = {
      eventBus: makeBus(),
      userService: { getAllProfiles: () => profiles() },
      loadFitnessConfig: () => ({ locks: {}, users: { admin: ['kc'] }, emergency: { abuse: { threshold: 3, window_sec: 30 } } }),
      now: () => t,
      logger: { debug() {}, info() {}, warn() {} },
    };
    createIdentityRelay(d);
    const noAccess = () => d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-guest' });
    t = 1000; noAccess();
    t = 2000; noAccess();
    t = 3000; noAccess();
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeDefined();
  });

  it('does not trip when abuse protection is disabled', () => {
    let t = 0;
    const d = abuseDeps(() => t, {
      loadFitnessConfig: () => ({ locks: {}, users: { admin: ['kc'] }, emergency: { abuse: { enabled: false } } }),
    });
    createIdentityRelay(d);
    for (let i = 1; i <= 5; i++) { t = 1000 * i; fail(d.eventBus); }
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
  });

  it('suppresses re-trips during the cooldown window', () => {
    let t = 0;
    const d = abuseDeps(() => t);
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus); // trips; cooldown until 63000
    t = 4000; fail(d.eventBus);
    t = 5000; fail(d.eventBus);
    t = 6000; fail(d.eventBus);
    const ceremonies = d.eventBus.broadcasts.filter((b) => b.topic === 'fitness.emergency.ceremony');
    expect(ceremonies).toHaveLength(1);
  });

  it('fails closed: a lockdown-state lookup error does NOT trip or stamp a pending', async () => {
    let t = 0;
    const d = abuseDeps(() => t, { getLockdownState: { execute: async () => { throw new Error('repo down'); } } });
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    expect(relay.consumePendingDetection(3000)).toBeNull();
  });

  it('does not trip (or stamp a synthetic pending) while a lockdown is already active', async () => {
    let t = 0;
    const d = abuseDeps(() => t, { getLockdownState: { execute: async () => ({ lockedUntil: 9999999999 }) } });
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    await new Promise((r) => setTimeout(r, 0)); // let tripAbuse's async lock-check settle
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    expect(relay.consumePendingDetection(3000)).toBeNull();
  });
});
