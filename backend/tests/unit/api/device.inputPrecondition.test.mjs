// backend/tests/unit/api/device.inputPrecondition.test.mjs
//
// Regression guard: `GET /device/:id/load` must refuse to dispatch content
// when the device declares `input.required: true` and the keymap is empty.
// See bug: 2026-04-23 office keypad dead while video played unstoppably.

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createDeviceRouter } from '../../../src/4_api/v1/routers/device.mjs';

function makeApp({ deviceConfig, keyboardEntries, wakeAndLoad = async () => ({ ok: true }) }) {
  const app = express();
  const configService = {
    getDeviceConfig: () => deviceConfig,
  };
  const loadFile = (_path) => keyboardEntries;
  const router = createDeviceRouter({
    deviceService: { listDevices: () => [], get: () => ({ id: 'office-tv' }) },
    wakeAndLoadService: { execute: wakeAndLoad },
    configService,
    loadFile,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  });
  app.use('/', router);
  return app;
}

async function get(app, path) {
  const http = await import('node:http');
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      });
    });
  });
}

describe('device router — input precondition', () => {
  it('GET /:id/load refuses when input.required and keymap is empty', async () => {
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [], // empty keymap!
      wakeAndLoad: async () => { throw new Error('wake-and-load should not have been called'); },
    });
    const res = await get(app, '/office-tv/load?queue=office-program');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.failedStep, 'input');
    assert.strictEqual(res.body.keyboardId, 'officekeypad');
    assert.match(res.body.error, /no keymap entries/);
  });

  it('GET /:id/load refuses when keymap has entries for a different keyboard', async () => {
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [
        // entries for a different keyboard only
        { folder: 'tv-remote', key: '1', label: 'play', function: 'playback' },
      ],
      wakeAndLoad: async () => { throw new Error('wake-and-load should not have been called'); },
    });
    const res = await get(app, '/office-tv/load');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.failedStep, 'input');
  });

  it('GET /:id/load proceeds when keymap has entries for the requested keyboard', async () => {
    let executed = false;
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [
        { folder: 'officekeypad', key: '1', label: 'play', function: 'playback', params: 'next' },
        { folder: 'officekeypad', key: '2', label: 'pause', function: 'playback', params: 'pause' },
      ],
      wakeAndLoad: async () => { executed = true; return { ok: true, deviceId: 'office-tv' }; },
    });
    const res = await get(app, '/office-tv/load?queue=office-program');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(executed, true);
  });

  it('GET /:id/load proceeds when device has no input config', async () => {
    let executed = false;
    const app = makeApp({
      deviceConfig: { /* no input */ },
      keyboardEntries: [],
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await get(app, '/livingroom-tv/load');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(executed, true);
  });

  it('GET /:id/load proceeds when input is declared but required:false', async () => {
    let executed = false;
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: false } },
      keyboardEntries: [], // empty, but not required
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await get(app, '/office-tv/load');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(executed, true);
  });

  it('GET /:id/load tolerates whitespace/case mismatches in keyboard_id folders', async () => {
    let executed = false;
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [
        { folder: ' OfficeKeypad ', key: '1', label: 'play', function: 'playback' },
      ],
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await get(app, '/office-tv/load');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(executed, true);
  });
});
