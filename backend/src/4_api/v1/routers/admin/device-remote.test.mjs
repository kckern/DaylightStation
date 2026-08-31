import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { permissionGate } from '../../../middleware/permissionGate.mjs';
import { createAdminDeviceRemoteRouter } from './device-remote.mjs';

function build(overrides = {}, { authorize = false } = {}) {
  const service = {
    getStatus: vi.fn(async () => ({ ok: true, device: { id: 'tablet' } })),
    getScreenshot: vi.fn(async () => ({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      capturedAt: '2026-08-31T12:00:00.000Z',
    })),
    getSettings: vi.fn(async () => ({ ok: true, settings: [] })),
    performAction: vi.fn(async (_deviceId, action) => ({ ok: true, action })),
    updateSetting: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(express.json());
  if (authorize) {
    app.use('/api/v1', (req, _res, next) => {
      const role = req.get('x-test-role');
      if (role) {
        req.roles = [role];
        req.user = { id: 'test-user' };
      }
      next();
    });
    app.use('/api/v1', permissionGate({
      roles: {
        admin: { apps: ['admin'] },
        parent: { apps: ['dashboard'] },
      },
      appRoutes: { admin: ['admin/*'] },
      logger,
    }));
    app.use(
      '/api/v1/admin/household/devices/:deviceId/fully-kiosk',
      createAdminDeviceRemoteRouter({ service, logger }),
    );
  } else {
    app.use('/devices/:deviceId/fully-kiosk', createAdminDeviceRemoteRouter({ service, logger }));
  }
  return { app, service, logger };
}

describe('Admin Fully Kiosk router', () => {
  it('returns status for the merged device parameter', async () => {
    const { app, service } = build();
    const response = await request(app)
      .get('/devices/tablet/fully-kiosk/status')
      .expect(200);

    expect(response.body).toEqual({ ok: true, device: { id: 'tablet' } });
    expect(service.getStatus).toHaveBeenCalledWith('tablet');
  });

  it('serves uncached PNG data with capture and download metadata', async () => {
    const { app, service } = build();
    const response = await request(app)
      .get('/devices/tablet/fully-kiosk/screenshot')
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect('Content-Type', /^image\/png/)
      .expect('Cache-Control', 'no-store')
      .expect('X-Captured-At', '2026-08-31T12:00:00.000Z')
      .expect('Content-Disposition', 'inline; filename="tablet-screenshot.png"')
      .expect(200);

    expect(Buffer.from(response.body)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(service.getScreenshot).toHaveBeenCalledWith('tablet');
  });

  it('returns the curated settings view', async () => {
    const { app, service } = build({
      getSettings: vi.fn(async () => ({ ok: true, settings: [{ key: 'keepScreenOn' }] })),
    });
    const response = await request(app)
      .get('/devices/tablet/fully-kiosk/settings')
      .expect(200);

    expect(response.body.settings).toEqual([{ key: 'keepScreenOn' }]);
    expect(service.getSettings).toHaveBeenCalledWith('tablet');
  });

  it('forwards semantic action input on a registered-device route', async () => {
    const { app, service } = build();
    const response = await request(app)
      .post('/devices/tablet/fully-kiosk/actions/load-url')
      .send({ url: 'https://example.test/' })
      .expect(200);

    expect(response.body).toMatchObject({ ok: true, action: 'load-url' });
    expect(service.performAction).toHaveBeenCalledWith('tablet', 'load-url', { url: 'https://example.test/' });
  });

  it('forwards a setting key and its value', async () => {
    const { app, service } = build();
    await request(app)
      .put('/devices/tablet/fully-kiosk/settings/keepScreenOn')
      .send({ value: false, ignored: 'value' })
      .expect(200);

    expect(service.updateSetting).toHaveBeenCalledWith('tablet', 'keepScreenOn', false);
  });

  it.each([
    ['INVALID_DEVICE_ID', 400],
    ['INVALID_REMOTE_DEVICE_INPUT', 400],
    ['INVALID_ACTION', 400],
    ['DEVICE_NOT_FOUND', 404],
    ['NOT_FULLY_KIOSK', 422],
    ['FKB_CONFIGURATION_ERROR', 503],
    ['FKB_TIMEOUT', 504],
    ['FKB_UNREACHABLE', 502],
    ['FKB_AUTH_REJECTED', 502],
    ['FKB_COMMAND_REJECTED', 502],
    ['FKB_INVALID_RESPONSE', 502],
  ])('maps %s to HTTP %i', async (code, status) => {
    const error = Object.assign(new Error('private upstream details'), { code });
    const { app } = build({ getStatus: vi.fn(async () => { throw error; }) });
    const response = await request(app)
      .get('/devices/tablet/fully-kiosk/status')
      .expect(status);

    expect(response.body).toMatchObject({ ok: false, code });
    if (status >= 500) expect(response.body.error).not.toContain('private upstream details');
  });

  it('returns validation messages but hides unknown internal failures', async () => {
    const validation = Object.assign(new Error('level must be an integer from 0 to 255'), {
      name: 'ValidationError',
      code: 'INVALID_REMOTE_DEVICE_INPUT',
    });
    const validApp = build({ performAction: vi.fn(async () => { throw validation; }) }).app;
    const validationResponse = await request(validApp)
      .post('/devices/tablet/fully-kiosk/actions/set-brightness')
      .send({ level: 999 })
      .expect(400);
    expect(validationResponse.body.error).toBe('level must be an integer from 0 to 255');

    const internal = new Error('database password and stack details');
    const brokenApp = build({ getStatus: vi.fn(async () => { throw internal; }) }).app;
    const internalResponse = await request(brokenApp)
      .get('/devices/tablet/fully-kiosk/status')
      .expect(500);
    expect(internalResponse.body).toEqual({ ok: false, error: 'Internal server error', code: 'INTERNAL' });
  });

  it('requires identity and Admin app permission on the real API route prefix', async () => {
    const { app, service } = build({}, { authorize: true });

    await request(app)
      .get('/api/v1/admin/household/devices/tablet/fully-kiosk/status')
      .expect(401, { error: 'Authentication required' });
    await request(app)
      .get('/api/v1/admin/household/devices/tablet/fully-kiosk/status')
      .set('x-test-role', 'parent')
      .expect(403, { error: 'Insufficient permissions' });
    await request(app)
      .get('/api/v1/admin/household/devices/tablet/fully-kiosk/status')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });
});
