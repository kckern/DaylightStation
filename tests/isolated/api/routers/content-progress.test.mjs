import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentRouter } from '#api/v1/routers/content.mjs';

function makeApp(updateContentProgress) {
  const app = express();
  app.use(express.json());
  app.use('/content', createContentRouter({ updateContentProgress }));
  return app;
}

describe('POST /content/progress/:source/*', () => {
  it('delegates semantic progress input and preserves the response body', async () => {
    const response = { contentId: 'plex:44', playhead: 90, duration: 100, percent: 90, watched: true };
    const updateContentProgress = {
      isConfigured: () => true,
      execute: vi.fn().mockResolvedValue(response),
    };

    const result = await request(makeApp(updateContentProgress))
      .post('/content/progress/plex/44')
      .send({ seconds: 90, duration: 100 })
      .expect(200);

    expect(updateContentProgress.execute).toHaveBeenCalledWith({
      source: 'plex',
      localId: '44',
      seconds: 90,
      duration: 100,
    });
    expect(result.body).toEqual(response);
  });

  it('preserves configuration, validation, and unknown-source errors', async () => {
    await request(makeApp(null))
      .post('/content/progress/plex/44')
      .send({ seconds: 90, duration: 100 })
      .expect(501, { error: 'Media progress storage not configured' });

    const updateContentProgress = {
      isConfigured: () => true,
      execute: vi.fn().mockResolvedValue(null),
    };
    await request(makeApp(updateContentProgress))
      .post('/content/progress/plex/44')
      .send({ seconds: 90 })
      .expect(400, { error: 'seconds and duration are required numbers' });
    await request(makeApp(updateContentProgress))
      .post('/content/progress/missing/44')
      .send({ seconds: 90, duration: 100 })
      .expect(404, { error: 'Unknown source: missing' });
  });
});
