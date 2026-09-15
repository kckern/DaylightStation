import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAcceptancePlaybackRead } from '../../_lib/media-redesign-playback-read.mjs';
import { createPlayRouter } from '../../../backend/src/4_api/v1/routers/play.mjs';

function setup(fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({
  id: 'plex:55854', mediaType: 'dash_video', duration: 6982, resume_position: 183,
}) }))) {
  const adapter = {
    source: 'plex', prefixes: [],
    getItem: async () => ({ id: 'plex:55854', title: 'Arrival', mediaType: 'hls_video',
      mediaUrl: '/api/v1/proxy/plex/stream/55854', duration: 6982, resumable: true, metadata: {} }),
    getList() {}, resolvePlayables() {}, resolveSiblings() {},
  };
  return createAcceptancePlaybackRead({ adapter, upstream: 'http://127.0.0.1:3111', fetchImpl });
}

describe('branch acceptance playback-read composition', () => {
  it('presents branch descriptors through the real HTTP play router', async () => {
    const app = express();
    app.use('/api/v1/play', createPlayRouter({ playbackReadService: setup() }));
    const response = await request(app).get('/api/v1/play/plex:55854?session=owned%231');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'plex:55854', mediaType: 'hls_video', format: 'hls_video', resume_position: 183 });
    expect(response.body.mediaUrl).toContain('session=owned%231');
  });
  it('uses branch descriptor and actual upstream resume through the existing application services', async () => {
    const result = await setup().resolve({ compoundId: 'plex:55854', session: 'owned#1' });
    expect(result.kind).toBe('found');
    expect(result.body).toMatchObject({ id: 'plex:55854', mediaType: 'hls_video', format: 'hls_video', resume_position: 183 });
    expect(result.body.mediaUrl).toContain('session=owned%231');
  });
  it('honors existing resume=false instead of injecting a synthetic zero spot', async () => {
    const result = await setup().resolve({ compoundId: 'plex:55854', resume: false });
    expect(result.body).not.toHaveProperty('resume_position');
    expect(result.body.mediaUrl).not.toContain('offset=');
  });
  it('fails closed when the real progress source is unavailable', async () => {
    const read = setup(vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(read.resolve({ compoundId: 'plex:55854' })).rejects.toThrow('Acceptance progress source unavailable');
  });
});
