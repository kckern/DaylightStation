import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlTokenRegistry } from './YamlTokenRegistry.mjs';
import { HmacSchoolMountReceiptIssuer } from '../actions/HmacSchoolMountReceiptIssuer.mjs';
import { AcknowledgeSelfServiceMount } from '../../application/usecases/AcknowledgeSelfServiceMount.mjs';
import { RunSelfServiceAction } from '../../application/usecases/RunSelfServiceAction.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const T = Date.parse('2026-11-16T12:00:00Z');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'school-mount-')); roots.push(root);
  const configService = { getHouseholdPath: () => root };
  const registry = new YamlTokenRegistry({ configService, now: () => T });
  const record = { token: 'sch:TESTTOKEN', tokenClass: 'subject_next', subject: { learnerId: 'kid1', subject: 'reading' }, accessCode: '123456', accessCodeExpiresAt: new Date(T+3600000).toISOString(), expiresAt: new Date(T+3600000).toISOString(), maxUses: 1 };
  await registry.put(record);
  return { registry, record, configService };
}
describe('durable local mount use accounting', () => {
  it('three failed mounts leave useCount unchanged', async () => {
    const { registry, record } = await fixture();
    const issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home', clock: () => T });
    const ack = new AcknowledgeSelfServiceMount({ tokens: registry, mountReceiptIssuer: issuer, clock: () => new Date(T) });
    const runner = new RunSelfServiceAction({ tokens: registry, sessions: {}, mountAcknowledgements: true,
      mountReceiptIssuer: issuer, clock: () => new Date(T), logger: {},
      resolveAccessCode: { resolve: async () => ({ record, card: { ok: true, learner: 'kid1', actions: [{ kind: 'program', target: 'books' }] }, resolution: {} }) },
      launchers: new Map([['books', { surface: 'portal', launch() {}, issueLaunchTarget: () => ({ kind: 'program', program: 'books' }) }]]) });
    for (let i=0;i<3;i++) {
      const answer = await runner.execute({ code: '123456', action: 'program', mountProtocol: 1, deviceId: 'kiosk1' });
      // A prepared response alone must never spend a use; a browser may fail before ACK.
      expect((await registry.get(record.token)).useCount ?? 0).toBe(0);
      expect(answer.outcome).toBe('mount');
      expect(await ack.execute({ receipt: answer.mountReceipt, mounted: false, deviceId: 'kiosk1' })).toEqual({ ok: true, committed: false, replayed: false });
    }
  });
});

const reservation = (useId, now = T) => ({ useId, deviceId: 'kiosk1', learnerId: 'kid1', action: 'program', at: new Date(now).toISOString(), expiresAt: new Date(now+120000).toISOString() });
it('duplicate confirmed ACK commits once across repository reopen', async () => {
  const { registry, record, configService } = await fixture();
  const use = reservation('first');
  expect(await registry.reserveMountUse(record.token, use)).toEqual({ reserved: true });
  const issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home', clock: () => T });
  const receipt = issuer.issue({ ...use, token: record.token });
  const ack = tokens => new AcknowledgeSelfServiceMount({ tokens, mountReceiptIssuer: issuer, clock: () => new Date(T) });
  expect(await ack(registry).execute({ receipt, mounted: true, deviceId: 'kiosk1' })).toEqual({ ok: true, committed: true, replayed: false });
  const reopenedRegistry = new YamlTokenRegistry({ configService, now: () => T });
  expect(await ack(reopenedRegistry).execute({ receipt, mounted: true, deviceId: 'kiosk1' })).toEqual({ ok: true, committed: true, replayed: true });
  expect((await reopenedRegistry.get(record.token)).useCount).toBe(1);
  expect(await reopenedRegistry.settleMountUse(record.token, { ...use, mounted: false })).toEqual({ ok: true, committed: true, replayed: true });
});
it('expired reservations release capacity and concurrent final-slot requests reserve once', async () => {
  const { registry, record } = await fixture();
  const reservationResults = await Promise.all(Array.from({ length: 12 }, (_, i) => registry.reserveMountUse(record.token, reservation(`use${i}`))));
  expect(reservationResults.filter(x=>x.reserved)).toHaveLength(1);
  const afterExpiry = await registry.reserveMountUse(record.token, reservation('after', T+120000));
  expect(afterExpiry.reserved).toBe(true);
  expect((await registry.get(record.token)).useCount ?? 0).toBe(0);
});
it('rechecks revocation, token expiry, learner and reservation action on settlement', async () => {
  const { registry, record } = await fixture();
  const use = reservation('first');
  await registry.reserveMountUse(record.token, use);
  for (const changed of [{ learnerId: 'other' }, { deviceId: 'other' }, { action: 'print' }, { at: new Date(T+120000).toISOString() }]) {
    expect((await registry.settleMountUse(record.token, { ...use, mounted: true, ...changed })).ok).toBe(false);
  }
  await registry.revoke(record.token, { at: new Date(T).toISOString() });
  expect((await registry.settleMountUse(record.token, { ...use, mounted: true })).ok).toBe(false);
  expect((await registry.get(record.token)).useCount ?? 0).toBe(0);
});
it('serializes concurrent settlement with ordinary uses without dropping fields', async () => {
  const { registry, record } = await fixture();
  const use = reservation('first');
  await registry.reserveMountUse(record.token, use);
  await Promise.all([registry.settleMountUse(record.token, { ...use, mounted: true }), registry.recordUse(record.token, { at: use.at })]);
  const persisted = await registry.get(record.token);
  expect(persisted.useCount).toBe(2);
  expect(persisted.mountUses.first.state).toBe('committed');
  expect(persisted.subject).toEqual(record.subject);
});
it('a stale metadata put cannot erase a committed reservation or revocation', async () => {
  const { registry, record } = await fixture(); const use = reservation('first');
  await registry.reserveMountUse(record.token, use);
  await registry.settleMountUse(record.token, { ...use, mounted: true });
  await registry.revoke(record.token, { at: use.at });
  await registry.put({ ...record, metadata: 'updated' });
  const current = await registry.get(record.token);
  expect(current.useCount).toBe(1);
  expect(current.mountUses.first.state).toBe('committed');
  expect(current.revokedAt).toBe(use.at);
  expect(current.metadata).toBe('updated');
});

function runnerFor(registry, record, { enabled = true, issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home', clock: () => T }), target = () => ({ kind: 'program', program: 'books' }) } = {}) {
  return new RunSelfServiceAction({ tokens: registry, sessions: {}, mountAcknowledgements: enabled, mountReceiptIssuer: issuer, clock: () => new Date(T), logger: {},
    resolveAccessCode: { resolve: async () => ({ record, card: { ok: true, learner: 'kid1', actions: [{ kind: 'program', target: 'books' }] }, resolution: {} }) },
    launchers: new Map([['books', { surface: 'portal', launch() {}, issueLaunchTarget: target }]]) });
}
it('stages browser support with the flag off, then refuses old bundles without reserving or spending', async () => {
  const { registry, record } = await fixture();
  const old = await runnerFor(registry, record, { enabled: false }).execute({ code: '123456', action: 'program', mountProtocol: 1 });
  expect(old.outcome).toBe('mount'); expect(old.mountReceipt).toBeUndefined();
  expect((await registry.get(record.token)).useCount).toBe(1);
  const fresh = await fixture();
  const unsupported = await runnerFor(fresh.registry, fresh.record).execute({ code: '123456', action: 'program', deviceId: 'kiosk1' });
  expect(unsupported.outcome).toBe('refused'); expect(unsupported.sentence).toMatch(/Refresh/);
  expect((await fresh.registry.get(fresh.record.token)).mountUses).toBeUndefined();
  expect((await fresh.registry.get(fresh.record.token)).useCount ?? 0).toBe(0);
});
it('reserves before grant issuance and releases the slot when issuance throws', async () => {
  const { registry, record } = await fixture(); let pendingAtIssuance;
  const failed = await runnerFor(registry, record, { target: async () => {
    pendingAtIssuance = Object.values((await registry.get(record.token)).mountUses).filter(use => use.state === 'pending').length;
    throw new Error('issuer unavailable');
  } }).execute({ code: '123456', action: 'program', deviceId: 'kiosk1', mountProtocol: 1 });
  expect(pendingAtIssuance).toBe(1); expect(failed.outcome).toBe('failed');
  const current = await registry.get(record.token);
  expect(Object.values(current.mountUses).every(use => use.state === 'released')).toBe(true);
  expect(current.useCount ?? 0).toBe(0);
  expect((await registry.reserveMountUse(record.token, reservation('retry'))).reserved).toBe(true);
});
it('enabled protocol without signing material refuses before reserving', async () => {
  const { registry, record } = await fixture();
  const answer = await runnerFor(registry, record, { issuer: null }).execute({ code: '123456', action: 'program', deviceId: 'kiosk1', mountProtocol: 1 });
  expect(answer.outcome).toBe('failed'); expect((await registry.get(record.token)).mountUses).toBeUndefined();
});

it('a token expiring before its receipt cannot settle', async () => {
  const { registry, record } = await fixture(); const use = reservation('first');
  await registry.reserveMountUse(record.token, use);
  await registry.put({ ...record, expiresAt: new Date(T+1000).toISOString() });
  expect((await registry.settleMountUse(record.token, { ...use, mounted: true, at: new Date(T+1000).toISOString() })).ok).toBe(false);
  expect((await registry.get(record.token)).useCount ?? 0).toBe(0);
});
