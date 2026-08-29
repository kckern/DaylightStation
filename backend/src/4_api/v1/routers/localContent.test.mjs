import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLocalContentRouter } from './localContent.mjs';

function appFor(localContentService, options = {}) {
  const app = express();
  app.use('/api/v1/local-content', createLocalContentRouter({ localContentService, ...options }));
  return app;
}

describe('local-content API translation', () => {
  it('preserves the scripture response envelope while the use case remains semantic', async () => {
    const localContentService = { getScripture: vi.fn(async () => ({
      kind: 'found',
      value: {
        input: '1-nephi-1', reference: '1 Nephi 1', volume: 'bom', version: 'se',
        verseId: '31103', assetId: 'bom/se/31103', duration: 12, verses: [{ text: 'I, Nephi' }],
      },
    })) };
    const response = await request(appFor(localContentService)).get('/api/v1/local-content/scripture/1-nephi-1').expect(200);
    expect(response.body).toEqual({
      input: '1-nephi-1', reference: '1 Nephi 1', volume: 'bom', version: 'se',
      verse_id: '31103', assetId: 'bom/se/31103',
      mediaUrl: '/api/v1/proxy/local-content/stream/scripture/bom/se/31103',
      duration: 12, verses: [{ text: 'I, Nephi' }],
    });
    expect(response.headers).not.toHaveProperty('deprecation');
    expect(response.headers).not.toHaveProperty('sunset');
  });

  it.each([
    [{ kind: 'unconfigured' }, 500, { error: 'LocalContent adapter not configured' }],
    [{ kind: 'invalid', input: 'bad' }, 400, { error: 'Invalid scripture reference', input: 'bad' }],
    [{ kind: 'not_found', input: 'bad', resolved: 'bom/se/1' }, 404, { error: 'Scripture not found', input: 'bad', resolved: 'bom/se/1' }],
  ])('translates scripture failures to the established status and body', async (outcome, status, body) => {
    const response = await request(appFor({ getScripture: async () => outcome }))
      .get('/api/v1/local-content/scripture/bad')
      .expect(status);
    expect(response.body).toEqual(body);
  });

  it('delegates collection files through the opaque sendFile seam with the established headers', async () => {
    const resource = { size: 3, mimeType: 'image/png', open: vi.fn() };
    const sendFileResource = vi.fn((_req, res, received) => res.status(204).end());
    const localContentService = { getCollectionIcon: vi.fn(() => ({ kind: 'found', value: { resource } })) };
    const response = await request(appFor(localContentService, { sendFileResource }))
      .get('/api/v1/local-content/collection-icon/plex/family')
      .expect(204);
    expect(sendFileResource).toHaveBeenCalledWith(expect.anything(), expect.anything(), resource);
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.headers['content-type']).toMatch(/^image\/png/);
  });
});
