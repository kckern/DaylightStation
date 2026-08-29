import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalFileResource } from '#system/http/streamFile.mjs';
import { createLanguageReelsRouter } from './languageReels.mjs';
import { createFeedbackRouter } from './feedback.mjs';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { createPresentationRouter } from './presentation.mjs';
import { GetPublicPresentationCatalog } from '#apps/presentation/GetPublicPresentationCatalog.mjs';

let directory;
const resources = {};

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opaque-api-files-'));
  for (const [name, mimeType] of [
    ['reel.mp4', 'video/mp4'],
    ['feedback.webm', 'audio/webm'],
    ['flashcard.mp3', 'audio/mpeg'],
    ['presentation.png', 'image/png'],
  ]) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, '0123456789');
    resources[name] = createLocalFileResource(file, { mimeType });
  }
});

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

function appAt(mount, router) {
  const app = express();
  app.use(mount, router);
  return app;
}

function expectNativeFileHeaders(response) {
  expect(response.status).toBe(200);
  expect(response.headers['accept-ranges']).toBe('bytes');
  expect(response.headers['content-length']).toBe('10');
  expect(response.headers['last-modified']).toBeTruthy();
}

describe('opaque API local-file resources', () => {
  it('serves a language reel with its private cache contract and native ranges', async () => {
    const revision = 'rev-1';
    const app = appAt('/language-reels', createLanguageReelsRouter({
      grants: { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'kid', reelId: '123', revision } })) },
      service: {
        getReel: vi.fn(() => ({ revision })),
        mediaResource: vi.fn(() => resources['reel.mp4']),
      },
    }));

    const full = await request(app).get('/language-reels/media/123?grant=token');
    expectNativeFileHeaders(full);
    expect(full.headers['cache-control']).toBe('private, no-store');

    const range = await request(app).get('/language-reels/media/123?grant=token').set('Range', 'bytes=2-5');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toBe('bytes 2-5/10');
    expect(range.body.toString()).toBe('2345');
  });

  it('preserves feedback audio success and JSON not-found behavior', async () => {
    const feedbackService = {
      audioResource: vi.fn(() => resources['feedback.webm']),
      get: vi.fn(() => ({ id: '20260828120000_aaaaaa', app: 'piano', audio: 'audio/feedback/piano/20260828120000_aaaaaa.webm' })),
    };
    const app = appAt('/feedback', createFeedbackRouter({ feedbackService }));

    const details = await request(app).get('/feedback/piano/20260828120000_aaaaaa');
    expect(details.status).toBe(200);
    expect(details.body).toEqual({
      id: '20260828120000_aaaaaa',
      app: 'piano',
      audio: 'audio/feedback/piano/20260828120000_aaaaaa.webm',
    });

    const full = await request(app).get('/feedback/piano/20260828120000_aaaaaa/audio');
    expectNativeFileHeaders(full);

    feedbackService.audioResource.mockReturnValue(null);
    const missing = await request(app).get('/feedback/piano/20260828120000_missing/audio');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'audio not found' });
  });

  it('serves flashcard assets with the repository-provided content type', async () => {
    const app = appAt('/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      flashcardAssets: { get: vi.fn(() => ({ resource: resources['flashcard.mp3'], contentType: 'audio/mpeg' })) },
    }));

    const full = await request(app).get('/school/flashcards/assets/audio/test.mp3');
    expectNativeFileHeaders(full);
    expect(full.headers['content-type']).toMatch(/^audio\/mpeg/);
  });

  it('preserves presentation integrity cache headers and conditional 304', async () => {
    const sourceSha256 = 'a'.repeat(64);
    const catalog = { get: vi.fn(), getAsset: vi.fn(() => ({ sourceSha256, resource: resources['presentation.png'] })) };
    const app = appAt('/presentation', createPresentationRouter({
      catalog, getPublicCatalog: new GetPublicPresentationCatalog({ catalog }),
    }));
    const url = '/presentation/catalogs/demo/assets/hero/image';

    const full = await request(app).get(url);
    expectNativeFileHeaders(full);
    expect(full.headers.etag).toBe(`"${sourceSha256}"`);
    expect(full.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(full.headers['content-type']).toMatch(/^image\/png/);

    const conditional = await request(app).get(url).set('If-None-Match', `"${sourceSha256}"`);
    expect(conditional.status).toBe(304);
    expect(conditional.text).toBe('');
  });

  it('keeps backing paths out of every API-facing resource', () => {
    for (const resource of Object.values(resources)) {
      expect(Object.keys(resource)).toEqual(['size', 'mimeType', 'open']);
      expect(resource).not.toHaveProperty('path');
      expect(resource).not.toHaveProperty('filePath');
    }
  });
});
