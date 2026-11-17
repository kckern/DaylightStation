import { it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSchoolSelfServiceRouter } from './school.selfservice.mjs';
import { YamlTokenRegistry } from '../adapters/persistence/YamlTokenRegistry.mjs';
import { HmacSchoolMountReceiptIssuer } from '../adapters/actions/HmacSchoolMountReceiptIssuer.mjs';
import { RunSelfServiceAction } from '../application/usecases/RunSelfServiceAction.mjs';
import { AcknowledgeSelfServiceMount } from '../application/usecases/AcknowledgeSelfServiceMount.mjs';
import { SupervisionAccessGuard } from '../../../../household/supervision/server/application/SupervisionAccessGuard.mjs';
import { KioskSessionAuthority } from '../../../../household/supervision/server/adapters/KioskSessionAuthority.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const key = 'test-household-key-'.repeat(3);
const T = Date.parse('2026-11-16T12:00:00Z');
const route = '/api/v1/school/self-service';
async function setup(configured = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'school-ack-api-')); roots.push(root);
  const registry = new YamlTokenRegistry({ configService: { getHouseholdPath: () => root }, now: () => T });
  const record = { token: 'sch:APITESTTOKEN', tokenClass: 'subject_next', subject: { learnerId: 'kid1', subject: 'reading' }, accessCode: '123456', accessCodeExpiresAt: new Date(T+3600000).toISOString(), maxUses: 1 };
  await registry.put(record);
  const issuer = new HmacSchoolMountReceiptIssuer({ key, householdId: 'home1', clock: () => T });
  const resolver = { execute: async () => ({ ok: true, learner: 'kid1' }), resolve: async () => ({ record, card: { ok: true, learner: 'kid1', actions: [{ kind: 'program', target: 'books' }] }, resolution: {} }) };
  const runner = new RunSelfServiceAction({ tokens: registry, sessions: {}, mountAcknowledgements: true, mountReceiptIssuer: issuer, clock: () => new Date(T), logger: {}, resolveAccessCode: resolver, launchers: new Map([['books', { surface: 'portal', launch() {}, issueLaunchTarget: () => ({ kind: 'program', program: 'books' }) }]]) });
  const ack = new AcknowledgeSelfServiceMount({ tokens: registry, mountReceiptIssuer: issuer, clock: () => new Date(T) });
  const authority = new KioskSessionAuthority({ householdId: 'home1', secret: key, devices: { first: { credential: key }, second: { credential: key } }, clock: { now: () => T }, makeId: () => 'client-session' });
  let blocked = false;
  const guard = new SupervisionAccessGuard({ service: { exclusive: fn => fn(), status: async () => ({ epoch: 1, active: false, publication: 'acknowledged' }) }, stateGates: { decide: async context => ({ allowed: !blocked || !context.learnerId, decisionId: 'decision' }) }, clock: { now: () => T } });
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(route, createSchoolSelfServiceRouter({ resolveAccessCode: resolver, runSelfServiceAction: runner, acknowledgeSelfServiceMount: ack, mountReceiptIssuer: issuer,
    authorizeKioskAction: configured ? async (req, input = {}) => { const context = await authority.resolveContext(req, { activityId: 'school:workspace', learnerId: input.learnerId ?? null }); const permit = await guard.authorize(context); return { ...permit, deviceId: context.deviceId }; } : null }));
  app.use((err, req, res, next) => res.status(403).json({ ok: false }));
  return { app, registry, token: record.token, authority, blockLearner: () => { blocked = true; } };
}
it('legacy mounts bind to a server-issued HttpOnly session and never to body or proxy IP', async () => {
  const { app, registry, token } = await setup();
  const prepared = await request(app).post(route+'/act').send({ code: '123456', action: 'program', mountProtocol: 1, deviceId: 'invented' });
  expect(prepared.body.outcome).toBe('mount');
  expect(prepared.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
  expect(prepared.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
  const payload = { receipt: prepared.body.mountReceipt, mounted: true, deviceId: 'invented' };
  const denied = await request(app).post(route+'/mount-ack').set('X-Forwarded-For', '127.0.0.1').send(payload);
  expect(denied.body.ok).toBe(false);
  const accepted = await request(app).post(route+'/mount-ack').set('Cookie', prepared.headers['set-cookie']).send(payload);
  expect(accepted.body).toEqual({ ok: true, committed: true, replayed: false });
  expect(accepted.headers['cache-control']).toBe('no-store');
  expect((await registry.get(token)).useCount).toBe(1);
});
it('configured ACK requires the current authenticated kiosk and rejects spoofed body/query labels', async () => {
  const { app, authority, registry, token } = await setup(true);
  const first = await authority.issue({ deviceId: 'first', credential: key });
  const second = await authority.issue({ deviceId: 'second', credential: key });
  const prepared = await request(app).post(route+'/act').set('x-kiosk-session', first.token).send({ code: '123456', action: 'program', mountProtocol: 1 });
  const wrong = await request(app).post(route+'/mount-ack?deviceId=first').set('x-kiosk-session', second.token).send({ receipt: prepared.body.mountReceipt, mounted: true, deviceId: 'first' });
  expect(wrong.body.ok).toBe(false);
  expect((await registry.get(token)).useCount ?? 0).toBe(0);
  const accepted = await request(app).post(route+'/mount-ack').set('x-kiosk-session', first.token).send({ receipt: prepared.body.mountReceipt, mounted: true });
  expect(accepted.body.committed).toBe(true);
});
it('ACK bounds its receipt and requires a boolean mount result', async () => {
  const { app } = await setup();
  for (const payload of [{ receipt: 'x'.repeat(4097), mounted: true }, { receipt: 'x', mounted: 'true' }, { receipt: 'x', mounted: true, extra: 'x'.repeat(8200) }]) {
    const res = await request(app).post(route+'/mount-ack').send(payload);
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  }
});

it('rechecks current signed learner authorization on ACK', async () => {
  const { app, authority, registry, token, blockLearner } = await setup(true);
  const identity = await authority.issue({ deviceId: 'first', credential: key });
  const prepared = await request(app).post(route+'/act').set('x-kiosk-session', identity.token).send({ code: '123456', action: 'program', mountProtocol: 1 });
  expect(prepared.body.outcome).toBe('mount'); blockLearner();
  const denied = await request(app).post(route+'/mount-ack').set('x-kiosk-session', identity.token).send({ receipt: prepared.body.mountReceipt, mounted: true });
  expect(denied.status).toBe(403); expect((await registry.get(token)).useCount ?? 0).toBe(0);
});
