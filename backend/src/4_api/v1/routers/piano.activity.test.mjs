// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Build an app exercising GET /activity/recent with a controllable fake
 * pianoContainer (mirrors the fitness.emergency.test.mjs harness style —
 * express + supertest, fake dependencies injected directly, no vi.mock).
 */
function appWith({ isActivityConfigured, getRecentCourseActivity } = {}) {
  const pianoContainer = {
    isCourseServiceConfigured: vi.fn(() => false),
    isActivityConfigured: isActivityConfigured ?? vi.fn(() => false),
    getRecentCourseActivity: getRecentCourseActivity ?? vi.fn(() => ({ execute: async () => ({ players: [] }) })),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({ pianoContainer, logger: silentLogger })));
  return { app };
}

describe('piano router — GET /activity/recent', () => {
  it('returns the use case result', async () => {
    const { app } = appWith({
      isActivityConfigured: () => true,
      getRecentCourseActivity: () => ({ execute: async () => ({ players: [{ userId: 'kc' }] }) }),
    });
    const res = await request(app).get('/api/v1/piano/activity/recent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ players: [{ userId: 'kc' }] });
  });

  it('503s when not configured', async () => {
    const { app } = appWith({ isActivityConfigured: () => false });
    const res = await request(app).get('/api/v1/piano/activity/recent');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Piano activity service not configured');
  });
});
