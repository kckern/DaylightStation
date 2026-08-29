import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AdminMediaService } from '#apps/admin/AdminMediaService.mjs';
import { createAdminMediaRouter } from './media.mjs';

function build(sources) {
  const sourceCatalog = { list: vi.fn(async () => sources) };
  const mediaDownloadService = {
    fetchAndSaveMetadata: vi.fn(async () => ({ ok: true, title: 'Channel', thumbnailDownloaded: true,
      metadataRelPath: 'provider/metadata.yml', thumbnailRelPath: 'provider/thumb.jpg' })),
    fetchAndSaveMetadataAll: vi.fn(async () => ({ results: [{ ok: true }], total: 1, success: 1 })),
  };
  const app = express();
  app.use('/admin/media', createAdminMediaRouter({
    adminMediaService: new AdminMediaService({ sourceCatalog, mediaDownloadService }),
    logger: { error: vi.fn() },
  }));
  return { app, sourceCatalog, mediaDownloadService };
}

describe('admin media route characterization', () => {
  it('preserves source formatting and provider lookup', async () => {
    const source = {
      provider: 'provider', description: 'News', type: 'channel', id: 'UC1', folder: 'news',
      sourceRef: { platform: 'youtube', collectionType: 'channel', locator: 'UC1' },
    };
    const { app, mediaDownloadService } = build([source]);
    expect((await request(app).get('/admin/media/freshvideo/sources')).body).toEqual({ sources: [{
      provider: 'provider', description: 'News', type: 'channel', id: 'UC1', folder: 'news',
    }], count: 1 });
    expect((await request(app).post('/admin/media/freshvideo/provider/metadata')).body).toEqual({
      ok: true, provider: 'provider', title: 'Channel', thumbnailDownloaded: true,
      metadataPath: 'provider/metadata.yml', thumbnailPath: 'provider/thumb.jpg',
    });
    expect(mediaDownloadService.fetchAndSaveMetadata).toHaveBeenCalledWith(source);
    expect((await request(app).post('/admin/media/freshvideo/metadata/all')).body)
      .toEqual({ results: [{ ok: true }], total: 1, success: 1 });
  });

  it('preserves empty and missing-provider responses', async () => {
    const empty = build(null).app;
    expect((await request(empty).get('/admin/media/freshvideo/sources')).body).toEqual({ sources: [], count: 0 });
    expect((await request(empty).post('/admin/media/freshvideo/x/metadata')).body)
      .toEqual({ error: 'No freshvideo sources configured' });
    const missing = build([]).app;
    expect((await request(missing).post('/admin/media/freshvideo/x/metadata')).body)
      .toEqual({ error: 'Source not found: x' });
  });
});
