import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

function makeDevice(initialScreenOn, { statusThrows = false } = {}) {
  let screenOn = initialScreenOn;
  return {
    setScreen: async (on) => { screenOn = on; return { ok: true }; },
    getStatus: async () => { if (statusThrows) throw new Error('unreachable'); return { ready: true, screenOn }; },
    _screenOn: () => screenOn,
  };
}

function makeApp({ device, screenOverrideService, pianoMidiWakeService, piano = {} }) {
  const app = express();
  app.use(express.json());
  app.use('/device', createDeviceRouter({
    deviceService: { get: () => device },
    screenOverrideService,
    pianoMidiWakeService,
    configService: { getHouseholdAppConfig: () => piano },
    logger: { info() {}, warn() {}, error() {} },
  }));
  return app;
}

describe('device screen override routes', () => {
  let override;
  beforeEach(() => { override = new ScreenOverrideService(); });

  it('toggle from OFF turns the screen ON and sets an on-hold window', async () => {
    const device = makeDevice(false);
    const app = makeApp({ device, screenOverrideService: override, piano: { button: { onHoldMinutes: 10 } } });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.status).toBe(200);
    expect(res.body.screenOn).toBe(true);
    expect(device._screenOn()).toBe(true);
    expect(override.get('yellow-room-tablet')?.state).toBe('on');
  });

  it('toggle from ON turns the screen OFF and clears the window (soft off)', async () => {
    const device = makeDevice(true);
    const app = makeApp({ device, screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.body.screenOn).toBe(false);
    expect(device._screenOn()).toBe(false);
    expect(override.get('yellow-room-tablet')).toBeNull();
  });

  it('toggle fails safe to ON when getStatus throws', async () => {
    const device = makeDevice(false, { statusThrows: true });
    const app = makeApp({ device, screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/toggle');
    expect(res.body.screenOn).toBe(true);
    expect(device._screenOn()).toBe(true);
  });

  it('POST override off drives the screen off and relays to midi-wake suppress', async () => {
    const device = makeDevice(true);
    const relayed = [];
    const pianoMidiWakeService = { suppressWakeUntil: (until) => { relayed.push(until); override.set('yellow-room-tablet', 'off', 30); } };
    const app = makeApp({ device, screenOverrideService: override, pianoMidiWakeService, piano: { screensaver: { offCooldownMinutes: 30 } } });
    const res = await request(app).post('/device/yellow-room-tablet/screen/override').send({ state: 'off' });
    expect(res.status).toBe(200);
    expect(device._screenOn()).toBe(false);
    expect(relayed.length).toBe(1);
    expect(override.get('yellow-room-tablet')?.state).toBe('off');
  });

  it('GET override reflects the live window', async () => {
    override.set('yellow-room-tablet', 'off', 30);
    const app = makeApp({ device: makeDevice(false), screenOverrideService: override });
    const res = await request(app).get('/device/yellow-room-tablet/screen/override');
    expect(res.body.override?.state).toBe('off');
  });

  it('404 when the device is unknown', async () => {
    const app = express();
    app.use(express.json());
    app.use('/device', createDeviceRouter({
      deviceService: { get: () => null },
      screenOverrideService: override,
      configService: { getHouseholdAppConfig: () => ({}) },
      logger: { info() {}, warn() {}, error() {} },
    }));
    const res = await request(app).get('/device/nope/screen/toggle');
    expect(res.status).toBe(404);
  });
});
