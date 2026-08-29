import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { DeviceFleetControlService } from '#apps/devices/services/DeviceFleetControlService.mjs';
import { DevicePresenceService } from '#apps/devices/services/DevicePresenceService.mjs';
import { DeviceSessionApiService } from '#apps/devices/services/DeviceSessionApiService.mjs';
import { DeviceScreenControlService } from '#apps/devices/services/DeviceScreenControlService.mjs';
import { DeviceContentDispatchService } from '#apps/devices/services/DeviceContentDispatchService.mjs';
import { DeviceRecoveryService } from '#apps/devices/services/DeviceRecoveryService.mjs';
import { DispatchIdempotencyService } from '#apps/devices/services/DispatchIdempotencyService.mjs';
import { createIdleSessionSnapshot } from '../../../shared/contracts/media/shapes.mjs';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const idleSnapshot = () => createIdleSessionSnapshot({
  sessionId: 'session-1', ownerId: 'tv', now: new Date('2026-08-28T00:00:00.000Z'),
});

function makeDevice(overrides = {}) {
  return {
    screenPath: '/screen/living-room',
    getState: vi.fn().mockResolvedValue({ id: 'tv', ready: true }),
    getStatus: vi.fn().mockResolvedValue({ screenOn: false }),
    healAudioBridge: vi.fn().mockResolvedValue({ ok: true }),
    powerOn: vi.fn().mockResolvedValue({ ok: true, action: 'on' }),
    powerOff: vi.fn().mockResolvedValue({ ok: true, action: 'off' }),
    toggle: vi.fn().mockResolvedValue({ ok: true, action: 'toggle' }),
    reboot: vi.fn().mockResolvedValue({ ok: true }),
    setScreen: vi.fn().mockResolvedValue({ ok: true }),
    hasCapability: vi.fn().mockReturnValue(true),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    setAudioDevice: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue(undefined),
    loadContent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function harness(options = {}) {
  const device = options.device ?? makeDevice();
  const devices = options.devices ?? {
    get: vi.fn(id => id === 'tv' ? device : null),
    listDevices: vi.fn(() => [{ id: 'tv' }]),
    listDeviceIds: vi.fn(() => ['tv']),
  };
  const configuration = options.configuration ?? {
    householdDevices: vi.fn(householdId => ({ householdId, devices: { tv: {} } })),
    device: vi.fn(() => null),
    piano: vi.fn(() => ({})),
  };
  const callControl = options.callControl ?? { hasActive: vi.fn(() => false), forceEnd: vi.fn() };
  const sessionControl = options.sessionControl === undefined ? {
    getSnapshot: vi.fn(() => ({ online: true, snapshot: idleSnapshot() })),
    sendCommand: vi.fn().mockResolvedValue({ ok: true, commandId: 'cmd-1' }),
    claim: vi.fn().mockResolvedValue({ ok: true, commandId: 'cmd-1', snapshot: idleSnapshot(), stoppedAt: 3 }),
  } : options.sessionControl;
  const wake = options.wake === undefined ? {
    execute: vi.fn().mockResolvedValue({ ok: true, totalElapsedMs: 1 }),
  } : options.wake;
  const idempotency = options.idempotency ?? new DispatchIdempotencyService({ clock: { now: () => Date.now() } });
  const services = {
    fleetService: new DeviceFleetControlService({ devices, configuration, callControl, logger }),
    presenceService: new DevicePresenceService({
      store: options.presenceStore ?? null, readGate: options.readGate ?? null,
    }),
    sessionService: new DeviceSessionApiService({ sessionControl, logger }),
    screenService: new DeviceScreenControlService({
      devices, configuration, screenOverrides: options.screenOverrides,
      midiWake: options.midiWake, logger, nowMs: () => 1_000,
    }),
    dispatchService: new DeviceContentDispatchService({
      wakeAndLoad: wake, idempotency, configuration,
      keyboardBindings: options.keyboardBindings, logger,
    }),
    recoveryService: options.recoveryService ?? new DeviceRecoveryService({
      devices, contentRequiresCamera: () => false, scheduler: { wait: vi.fn() }, logger,
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/device', createDeviceRouter(services));
  return { app, device, devices, configuration, callControl, sessionControl, wake, services };
}

describe('device router capability seams — preserved HTTP semantics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps config, list, state, and unknown-device response shapes', async () => {
    const { app } = harness();
    expect((await request(app).get('/device/config?householdId=home')).body)
      .toEqual({ householdId: 'home', devices: { tv: {} } });
    expect((await request(app).get('/device/')).body)
      .toEqual({ ok: true, count: 1, devices: [{ id: 'tv' }] });
    expect((await request(app).get('/device/tv')).body).toEqual({ ok: true, id: 'tv', ready: true });
    const missing = await request(app).get('/device/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' });
  });

  it('forwards the complete presence report and preserves gate/history output', async () => {
    const report = { devices: ['parent-phone'], seq: 8, uptimeMs: 100, version: '1.2' };
    const presenceStore = {
      record: vi.fn((_id, body) => ({ ...body, receivedAt: 123 })),
      get: vi.fn(() => ({ receivedAt: 123, devices: report.devices })),
      history: vi.fn(() => [{ state: 'allowed' }]),
    };
    const { app } = harness({ presenceStore, readGate: () => ({ allowed: true }) });
    const posted = await request(app).post('/device/tv/presence').send(report);
    expect(posted.body).toEqual({ ok: true, receivedAt: 123, seq: 8, count: 1 });
    expect(presenceStore.record).toHaveBeenCalledWith('tv', report);
    const read = await request(app).get('/device/tv/presence');
    expect(read.body).toEqual({
      presence: { receivedAt: 123, devices: ['parent-phone'] },
      transitions: [{ state: 'allowed' }], gate: { allowed: true },
    });
  });

  it('checks presence availability before validating the report', async () => {
    const { app } = harness();
    const result = await request(app).post('/device/tv/presence').send({ devices: 'wrong' });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'presence not configured' });
  });

  it('heals only existing, supported devices and reports an empty eligible fleet', async () => {
    const unsupported = makeDevice({ healAudioBridge: vi.fn().mockResolvedValue({ supported: false }) });
    const devices = {
      get: vi.fn(id => id === 'unsupported' ? unsupported : null),
      listDevices: vi.fn(() => []), listDeviceIds: vi.fn(() => ['missing', 'unsupported']),
    };
    const { app } = harness({ devices });
    const result = await request(app).post('/device/audio-bridge/heal').send({ force: true });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, healed: [], reason: 'no-eligible-devices' });
    expect(unsupported.healAudioBridge).toHaveBeenCalledWith({ force: true });
  });

  it('preserves session unavailable, unknown, offline, and idle status precedence', async () => {
    const unavailable = harness({ sessionControl: null }).app;
    expect((await request(unavailable).post('/device/tv/session/transport').send({})).status).toBe(501);

    const missing = harness({ sessionControl: { getSnapshot: () => null } }).app;
    expect((await request(missing).get('/device/tv/session')).status).toBe(404);

    const offline = harness({ sessionControl: {
      getSnapshot: () => ({ online: false, snapshot: { state: 'paused' }, lastSeenAt: 99 }),
    } }).app;
    const offlineResult = await request(offline).get('/device/tv/session');
    expect(offlineResult.status).toBe(503);
    expect(offlineResult.body).toEqual({ offline: true, lastKnown: { state: 'paused' }, lastSeenAt: 99 });

    expect((await request(harness().app).get('/device/tv/session')).status).toBe(204);
  });

  it('builds transport, queue, config, and claim envelopes without leaking HTTP concerns', async () => {
    const { app, sessionControl } = harness();
    await request(app).post('/device/tv/session/transport').send({ action: 'seekAbs', value: 12, commandId: 't1' });
    await request(app).post('/device/tv/session/queue/play-next').send({ contentId: 'plex:1', clearRest: true, commandId: 'q1' });
    await request(app).put('/device/tv/session/shuffle').send({ enabled: true, commandId: 's1' });
    const claimed = await request(app).post('/device/tv/session/claim').send({ commandId: 'c1' });
    expect(sessionControl.sendCommand.mock.calls.map(([envelope]) => ({
      targetDevice: envelope.targetDevice, command: envelope.command, params: envelope.params, commandId: envelope.commandId,
    }))).toEqual([
      { targetDevice: 'tv', command: 'transport', params: { action: 'seekAbs', value: 12 }, commandId: 't1' },
      { targetDevice: 'tv', command: 'queue', params: { op: 'play-next', contentId: 'plex:1', clearRest: true }, commandId: 'q1' },
      { targetDevice: 'tv', command: 'config', params: { setting: 'shuffle', value: true }, commandId: 's1' },
    ]);
    expect(sessionControl.claim).toHaveBeenCalledWith('tv', { commandId: 'c1' });
    expect(claimed.body).toMatchObject({ ok: true, commandId: 'cmd-1', stoppedAt: 3 });
  });

  it('maps offline command failures with lastKnown and validates before dispatch', async () => {
    const sessionControl = {
      getSnapshot: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({
        ok: false, code: 'DEVICE_OFFLINE', error: 'offline', lastKnown: { state: 'paused' },
      }),
      claim: vi.fn(),
    };
    const { app } = harness({ sessionControl });
    const invalid = await request(app).post('/device/tv/session/transport')
      .send({ action: 'seekAbs', value: '12', commandId: 'bad' });
    expect(invalid.status).toBe(400);
    expect(sessionControl.sendCommand).not.toHaveBeenCalled();
    const offline = await request(app).post('/device/tv/session/transport')
      .send({ action: 'pause', commandId: 'good' });
    expect(offline.status).toBe(409);
    expect(offline.body).toMatchObject({ code: 'DEVICE_OFFLINE', lastKnown: { state: 'paused' } });
  });

  it('blocks power-off during a call and force-ends only for force=true', async () => {
    const callControl = { hasActive: vi.fn(() => true), forceEnd: vi.fn() };
    const { app, device } = harness({ callControl });
    const blocked = await request(app).get('/device/tv/off');
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: 'DEVICE_BUSY', hint: 'Use ?force=true to override' });
    expect(device.powerOff).not.toHaveBeenCalled();
    expect((await request(app).get('/device/tv/off?force=true')).status).toBe(200);
    expect(callControl.forceEnd).toHaveBeenCalledWith('tv');
  });

  it('logs GET load before availability and validates required keyboard bindings before dispatch', async () => {
    const configuration = {
      householdDevices: vi.fn(), piano: vi.fn(() => ({})),
      device: vi.fn(() => ({ input: { required: true, keyboard_id: 'My Keys' } })),
    };
    const absent = harness({ configuration, wake: null }).app;
    expect((await request(absent).get('/device/tv/load')).status).toBe(500);
    expect(logger.info).toHaveBeenCalledWith('device.router.load.start', { deviceId: 'tv', query: {} });

    const wake = { execute: vi.fn() };
    const noBindings = harness({ configuration, wake, keyboardBindings: { list: () => [] } }).app;
    const failed = await request(noBindings).get('/device/tv/load');
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ failedStep: 'input', keyboardId: 'My Keys' });
    expect(wake.execute).not.toHaveBeenCalled();
  });

  it('separates dispatchId from content and preserves permanent-prewarm mapping', async () => {
    const wake = { execute: vi.fn().mockResolvedValue({
      ok: false, failedStep: 'prewarm', permanent: true, error: 'missing',
    }) };
    const { app } = harness({ wake });
    const result = await request(app).get('/device/tv/load?play=plex:1&dispatchId=d1');
    expect(wake.execute).toHaveBeenCalledWith('tv', { play: 'plex:1' }, { dispatchId: 'd1' });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ code: 'CONTENT_NOT_FOUND', failedStep: 'prewarm', permanent: true });
  });

  it('preserves adopt validation order and replay/conflict idempotency', async () => {
    const unavailable = harness({ wake: null }).app;
    expect((await request(unavailable).post('/device/tv/load').send({ mode: 'wrong' })).status).toBe(400);
    expect((await request(unavailable).post('/device/tv/load').send({ mode: 'adopt' })).status).toBe(500);

    const wake = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const { app } = harness({ wake });
    const snapshot = idleSnapshot();
    const body = { mode: 'adopt', snapshot, dispatchId: 'adopt-1' };
    expect((await request(app).post('/device/tv/load').send(body)).status).toBe(200);
    expect((await request(app).post('/device/tv/load').send(body)).status).toBe(200);
    expect(wake.execute).toHaveBeenCalledTimes(1);
    const conflict = await request(app).post('/device/tv/load').send({
      ...body, snapshot: { ...snapshot, position: 1 },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('retains legacy volume parsing after existence/capability checks', async () => {
    const device = makeDevice();
    const { app } = harness({ device });
    await request(app).get('/device/tv/volume/42');
    await request(app).get('/device/tv/volume/mute');
    expect(device.setVolume.mock.calls).toEqual([[42], ['mute']]);

    device.hasCapability.mockReturnValue(false);
    expect((await request(app).get('/device/tv/volume/90')).status).toBe(400);
    expect(device.setVolume).toHaveBeenCalledTimes(2);
  });
});

describe('DeviceRecoveryService timing and fallback', () => {
  it('waits 15s after ADB success, then prepares and reloads', async () => {
    const device = makeDevice();
    const sleep = vi.fn();
    const service = new DeviceRecoveryService({
      devices: { get: () => device }, contentRequiresCamera: () => true,
      screenAddressResolver: { resolve: () => ({ path: '/screen/living-room' }) },
      scheduler: { wait: sleep }, logger,
    });
    expect(await service.recover('tv', { play: 'camera:front' }))
      .toEqual({ kind: 'ok', body: { ok: true, method: 'adb-restart' } });
    expect(sleep).toHaveBeenCalledWith(15_000);
    expect(device.prepareForContent).toHaveBeenCalledWith({ skipCameraCheck: false });
    expect(device.loadContent).toHaveBeenCalledWith('/screen/living-room', { play: 'camera:front' });
  });

  it('falls back to the 10s/60s power-cycle sequence when ADB fails', async () => {
    const device = makeDevice({ reboot: vi.fn().mockResolvedValue({ ok: false }) });
    const sleep = vi.fn();
    const service = new DeviceRecoveryService({
      devices: { get: () => device }, contentRequiresCamera: () => false, scheduler: { wait: sleep }, logger,
    });
    const result = await service.recover('tv');
    expect(result.body.method).toBe('power-cycle');
    expect(sleep.mock.calls).toEqual([[10_000], [60_000]]);
    expect(device.powerOff).toHaveBeenCalledBefore(device.powerOn);
    expect(device.prepareForContent).toHaveBeenCalledWith({ skipCameraCheck: true });
  });
});
