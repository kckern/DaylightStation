import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createSchoolBookScansRouter } from './schoolBookScans.mjs';
import { PrepareBookScan } from '#apps/school/usecases/PrepareBookScan.mjs';
import { HmacSchoolBookGrantIssuer } from '#adapters/school/actions/HmacSchoolBookGrantIssuer.mjs';
import { BookLogProgramLauncher } from '#apps/school/BookLogProgramLauncher.mjs';
import { WakeScreenForBroadcast } from '#apps/devices/services/WakeScreenForBroadcast.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { resolveBookScanTarget } from '#composition/modules/schoolBookScans.mjs';
import { isKnownTopic } from '#adapters/eventbus/WebSocketEventBus.mjs';

describe('book scan HTTP and composition boundary', () => {
  it('hands out a real purpose-scoped grant only for a live scan/current roster and wakes without reload', async () => {
    const grants = new HmacSchoolBookGrantIssuer({ key: Buffer.alloc(32, 1) });
    const device = { powerOn: vi.fn(async () => ({ ok: true })), prepareForContent: vi.fn(async () => ({ ok: true })) };
    const wake = new WakeScreenForBroadcast({ devices: { get: id => id === 'tablet' ? device : null } });
    const broadcast = vi.fn();
    const notifications = new EventBusSchoolRealtimeAdapter({ eventBus: { broadcast } });
    // Use the production launcher with its read-only dependencies; scan/claim never read or mutate a reading log.
    const bookLog = { read: vi.fn(), append: vi.fn() };
    const launcher = new BookLogProgramLauncher({ bookLog, grants, assignments: { get: vi.fn() } });
    const service = new PrepareBookScan({ mintId: () => randomBytes(32).toString('base64url'), grants, resolveBook: { execute: async () => ({ status: 'not-found' }) },
      roster: () => [{ id: 'child' }], issueLaunchTarget: args => launcher.issueLaunchTarget(args),
      target: { deviceId: 'tablet', screenId: 'portal' }, wake: args => wake.execute(args), notifications });
    const app = express(); app.use(createSchoolBookScansRouter({ bookScans: service }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { message: error.message } }));
    expect((await request(app).post('/guessed/claim').send({ screenId: 'portal', learnerId: 'child' })).status).toBe(410);
    await service.receive({ code: '9780064400558', device: 'reader', eventId: 'test' });
    const preview = await request(app).get('/pending?screenId=portal');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/pending?screenId=browser')).body.intent).toBeNull();
    const id = preview.body.intent.id;
    expect((await request(app).post(`/${id}/claim`).send({ screenId: 'portal', learnerId: 'outsider' })).status).toBe(403);
    const response = await request(app).post(`/${id}/claim`).send({ screenId: 'portal', learnerId: 'child' });
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(grants.verify(response.body.launchTarget.bookGrant, { learnerId: 'child' }).ok).toBe(true);
    expect(grants.verify(response.body.launchTarget.bookGrant, { learnerId: 'sibling' }).ok).toBe(false);
    expect(bookLog.read).not.toHaveBeenCalled(); expect(bookLog.append).not.toHaveBeenCalled();
    expect(device.powerOn).toHaveBeenCalledTimes(1);
    expect(device.prepareForContent).toHaveBeenCalledWith({ skipCameraCheck: true, profile: 'broadcast' });
    expect(broadcast).toHaveBeenCalledWith('school', { type: 'school.book-scan', screenId: 'portal', intentId: id });
    expect(isKnownTopic('school')).toBe(true);
  });
  it('derives unique School targets including plural routes, refusing ambiguous and configured non-School devices', () => {
    let selected; let devices = { tablet: { screen_path: '/screens/portal' } };
    const cfg = { getHouseholdAppConfig: () => ({ bookScan: { targetDeviceId: selected } }), getHouseholdDevices: () => ({ devices }) };
    const resolve = () => resolveBookScanTarget({ configService: cfg, getScreenConfig: id => id === 'portal' ? { layout: { children: [{ widget: 'school' }] } } : {} });
    expect(resolve()).toEqual({ deviceId: 'tablet', screenId: 'portal' });
    devices.other = { screen_path: '/screen/portal' }; expect(resolve()).toBeNull();
    selected = 'tablet'; expect(resolve()?.deviceId).toBe('tablet');
    selected = 'missing'; expect(resolve()).toBeNull();
  });
});
it('content-only Fully Kiosk Portal wakes through the broadcast preparation without a false power-control failure', async () => {
  const configService = { getHouseholdAppConfig: () => ({}), getHouseholdDevices: () => ({ devices: { tablet: { screen_path: '/screen/portal', content_control: { type: 'fully-kiosk' } } } }) };
  const target = resolveBookScanTarget({ configService, getScreenConfig: () => ({ layout: { children: [{ widget: 'school' }] } }) });
  const device = { powerOn: vi.fn(async () => ({ ok: false, error: 'No device control configured' })), prepareForContent: vi.fn(async () => ({ ok: true })) };
  const wake = new WakeScreenForBroadcast({ devices: { get: () => device } });
  const result = await wake.execute({ target: target.deviceId, prepareOnly: target.prepareOnly === true });
  expect(result.ok).toBe(true); expect(device.powerOn).not.toHaveBeenCalled();
  expect(device.prepareForContent).toHaveBeenCalledWith({ skipCameraCheck: true, profile: 'broadcast' });
});
