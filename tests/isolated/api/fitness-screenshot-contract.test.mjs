import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

function appFor(screenshotService) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/fitness', createFitnessRouter({
    screenshotService,
    fitnessContentService: {},
    fitnessHardwareService: {},
    fitnessWebhookService: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }));
  return app;
}

describe('fitness screenshot HTTP contract', () => {
  it('maps a semantic capture receipt to the existing response envelope', async () => {
    const saveScreenshot = vi.fn(async () => ({
      kind: 'stored',
      sessionRef: '20260828abc',
      capture: {
        order: 7,
        resourceName: '2026-08-28_player_0007.png',
        resourceRef: 'fitness/2026-08-28/screenshots/2026-08-28_player_0007.png',
        capturedAt: 1234,
        byteLength: 3,
        role: 'player',
        mediaType: 'image/png',
      },
    }));
    const response = await request(appFor({ saveScreenshot })).post('/fitness/save_screenshot').send({
      sessionId: '20260828abc', imageBase64: 'data:image/png;base64,YWJj',
      mimeType: 'image/png', index: 7, timestamp: 1234, role: 'player',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true, sessionId: '20260828abc', index: 7,
      filename: '2026-08-28_player_0007.png',
      path: 'fitness/2026-08-28/screenshots/2026-08-28_player_0007.png',
      timestamp: 1234, size: 3, role: 'player', mimeType: 'image/png',
    });
    expect(saveScreenshot).toHaveBeenCalledWith(expect.objectContaining({
      image: 'data:image/png;base64,YWJj', mediaType: 'image/png',
    }));
  });

  it('preserves the legacy invalid-base64 error body', async () => {
    const error = Object.assign(new Error('Invalid image payload'), {
      name: 'ScreenshotValidationError', reason: 'empty',
    });
    const response = await request(appFor({ saveScreenshot: async () => { throw error; } }))
      .post('/fitness/save_screenshot').send({ sessionId: 's', imageBase64: 'bad' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ok: false, error: 'Invalid base64 payload' });
  });
});
