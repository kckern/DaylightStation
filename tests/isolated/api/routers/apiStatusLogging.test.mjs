import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApiRouter } from '#backend/src/4_api/v1/routers/api.mjs';
import { initializeLogging, resetLogging, getDispatcher } from '#backend/src/0_system/logging/dispatcher.mjs';
import {
  initSessionFileTransport,
  getSessionFileTransport,
  resetSessionFileTransport,
} from '#backend/src/0_system/logging/transports/sessionFile.mjs';

const mount = () => {
  const app = express();
  app.use('/api/v1', createApiRouter({ safeConfig: {}, routers: {} }));
  return app;
};

let tmpDir;

beforeEach(() => {
  resetLogging();
  resetSessionFileTransport();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-logging-'));
});

afterEach(() => {
  getSessionFileTransport()?.flush();
  resetSessionFileTransport();
  resetLogging();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * The dispatcher has counted its own drops since it was written and nothing
 * has ever read the number. A counter with no reader is not observability.
 */
describe('GET /api/v1/status — logging counters', () => {
  test('reports dispatcher metrics and transport names', async () => {
    initializeLogging({ defaultLevel: 'warn' });
    getDispatcher().addTransport({ name: 'capture', send: () => {} });

    // One event above the level and one below it, so both counters move.
    getDispatcher().dispatch({ level: 'error', event: 'kept' });
    getDispatcher().dispatch({ level: 'debug', event: 'below-level' });

    const res = await request(mount()).get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body.logging.metrics).toMatchObject({ sent: 1, dropped: 1, errors: 0 });
    expect(res.body.logging.transports).toContain('capture');
  });

  test('reports the session-file transport\'s dropped-event counts', async () => {
    initializeLogging({ defaultLevel: 'debug' });
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

    getSessionFileTransport().write({
      ts: '2026-08-16T18:32:00.000', level: 'info', event: 'piano.video.open', data: {},
      context: { app: 'piano-kiosk' },
    });

    const res = await request(mount()).get('/api/v1/status');

    expect(res.body.logging.sessionFile.skipped.total).toBe(1);
    expect(res.body.logging.sessionFile.skipped.byApp['piano-kiosk']).toBe(1);
  });

  test('says logging is uninitialized rather than throwing', async () => {
    const res = await request(mount()).get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.logging).toBeNull();
  });

  test('reports a null session file when that transport is not running', async () => {
    initializeLogging({ defaultLevel: 'debug' });

    const res = await request(mount()).get('/api/v1/status');

    expect(res.body.logging.sessionFile).toBeNull();
  });
});
