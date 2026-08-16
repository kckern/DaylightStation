// alternates-route.test.mjs — HTTP surface for "what else addresses this file?"
//
// The admin uses this to offer a working id when a row's action and its
// source's capabilities disagree (Display on a playable-only `files:` image).
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createContentRouter } from '#api/v1/routers/content.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { FilesystemCanvasAdapter } from '#adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('GET /api/v1/content/alternates', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: mediaPath }));
    registry.register(new FilesystemCanvasAdapter({
      basePath: path.join(mediaPath, 'docs'),
    }));

    app = express();
    app.use('/api/v1/content', createContentRouter(registry));
  });

  it('returns the canvas id for a files image', async () => {
    const res = await request(app)
      .get('/api/v1/content/alternates/files/docs/sheet-music/song.jpg')
      .expect(200);

    expect(res.body.contentId).toBe('files:docs/sheet-music/song.jpg');
    expect(res.body.alternates).toEqual([
      expect.objectContaining({
        contentId: 'canvas:sheet-music/song.jpg',
        capabilities: expect.arrayContaining(['displayable']),
      }),
    ]);
  });

  it('accepts a compound id in one segment', async () => {
    const res = await request(app)
      .get('/api/v1/content/alternates/files:docs%2Fsheet-music%2Fsong.jpg')
      .expect(200);

    expect(res.body.alternates[0].contentId).toBe('canvas:sheet-music/song.jpg');
  });

  it('returns an empty list, not an error, when nothing else reaches the file', async () => {
    // A quiet 200 keeps the admin from painting a scary state on a healthy row.
    const res = await request(app)
      .get('/api/v1/content/alternates/files/audio/test.mp3')
      .expect(200);

    expect(res.body.alternates).toEqual([]);
  });

  it('returns an empty list for a source with no filesystem identity', async () => {
    const res = await request(app)
      .get('/api/v1/content/alternates/plex/12345')
      .expect(200);

    expect(res.body.alternates).toEqual([]);
  });
});
