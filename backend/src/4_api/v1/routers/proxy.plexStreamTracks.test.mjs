import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from './proxy.mjs';
import { RegistryPlaybackStreamGateway } from '../../../1_adapters/proxy/RegistryPlaybackStreamGateway.mjs';

// RQ-STEER-14: a stream mint may carry the person's track choice. Without
// one, the mint request reaching the adapter is exactly what it was before.
function app(mint) {
  const a = express();
  a.use('/proxy', createProxyRouter({ mintPlaybackStream: { execute: mint }, logger: { warn() {}, info() {} } }));
  return a;
}

describe('GET /proxy/plex/stream/:ratingKey — track choice', () => {
  it('passes no tracks when none were asked for', async () => {
    const mint = vi.fn(async () => ({ kind: 'found', url: '/x' }));
    await request(app(mint)).get('/proxy/plex/stream/665638?offset=12&session=s1').expect(302);
    expect(mint).toHaveBeenCalledWith({ ratingKey: '665638', startOffset: 12, session: 's1' });
  });

  it('passes the chosen audio and subtitle stream ids', async () => {
    const mint = vi.fn(async () => ({ kind: 'found', url: '/x' }));
    await request(app(mint)).get('/proxy/plex/stream/665638?subtitleStreamID=1278358&audioStreamID=1278356').expect(302);
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({
      ratingKey: '665638', tracks: { audioStreamId: '1278356', subtitleStreamId: '1278358' },
    }));
  });

  it('ignores malformed ids', async () => {
    const mint = vi.fn(async () => ({ kind: 'found', url: '/x' }));
    await request(app(mint)).get('/proxy/plex/stream/665638?subtitleStreamID=abc').expect(302);
    expect(mint.mock.calls[0][0]).not.toHaveProperty('tracks');
  });
});

describe('RegistryPlaybackStreamGateway — track choice', () => {
  const gatewayWith = (adapter) => new RegistryPlaybackStreamGateway({
    registry: new Map([['plex', adapter]]), logger: { warn() {}, sampled() {} },
  });

  it('hands the tracks to the adapter only when present', async () => {
    const adapter = { getMediaUrl: vi.fn(async () => ({ url: '/u' })) };
    const gateway = gatewayWith(adapter);
    await gateway.mint({ ratingKey: '1', startOffset: 0, session: null });
    expect(adapter.getMediaUrl).toHaveBeenLastCalledWith('1', { startOffset: 0, session: null });
    await gateway.mint({ ratingKey: '1', startOffset: 0, session: null, tracks: { subtitleStreamId: '0' } });
    expect(adapter.getMediaUrl).toHaveBeenLastCalledWith('1', { startOffset: 0, session: null, tracks: { subtitleStreamId: '0' } });
  });
});
