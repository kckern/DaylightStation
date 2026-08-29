import { describe, test, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { RegistryPlaybackStreamGateway } from '#adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { MintPlaybackStream } from '#apps/proxy/MintPlaybackStream.mjs';

/**
 * Each call to this route mints a Plex transcode session, and the route logged
 * nothing at all on success — 19 lines, zero log calls. On 2026-08-16 it minted
 * 495 sessions in four minutes and produced not one line of our own telemetry;
 * the incident was reconstructed from Plex's server log.
 */
function harness({ mediaUrl = 'http://plex.example/video/:/transcode/x.mpd', reason } = {}) {
  const logger = {
    sampled: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const adapter = {
    getMediaUrl: vi.fn(async () => (mediaUrl ? { url: mediaUrl } : { url: null, reason })),
  };
  const registry = { get: (name) => (name === 'plex' ? adapter : null) };
  const gateway = new RegistryPlaybackStreamGateway({ registry, logger });
  const mintPlaybackStream = new MintPlaybackStream({ gateway });

  const app = express();
  app.use('/proxy', createProxyRouter({ mintPlaybackStream, logger }));
  return { app, logger, adapter };
}

const sampledCalls = (logger, event) =>
  logger.sampled.mock.calls.filter(([name]) => name === event);

describe('GET /proxy/plex/stream/:ratingKey — mint accounting', () => {
  let h;
  beforeEach(() => { h = harness(); });

  test('logs one sampled plex.stream.mint per successful mint', async () => {
    await request(h.app).get('/proxy/plex/stream/694719?offset=120');

    const calls = sampledCalls(h.logger, 'plex.stream.mint');
    expect(calls, 'a mint produced no log line').toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ ratingKey: '694719', startOffset: 120 });
    // Budgeted, so a storm reports an aggregate instead of 495 lines.
    expect(calls[0][2]).toMatchObject({ maxPerMinute: 20 });
  });

  test('carries the client session id when the caller supplies one', async () => {
    await request(h.app).get('/proxy/plex/stream/694719?session=IIni70e01E');

    expect(sampledCalls(h.logger, 'plex.stream.mint')[0][1]).toMatchObject({ session: 'IIni70e01E' });
  });

  // Absence has to be unambiguous: a missing field must say WHICH absence it
  // is, so `null` here means "the caller sent no session", never "unmeasured".
  test('records a null session rather than omitting the field', async () => {
    await request(h.app).get('/proxy/plex/stream/694719');

    expect(sampledCalls(h.logger, 'plex.stream.mint')[0][1]).toHaveProperty('session', null);
  });

  test('counts every repeat — the storm was one ratingKey minted over and over', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(h.app).get('/proxy/plex/stream/694719');
    }
    expect(sampledCalls(h.logger, 'plex.stream.mint')).toHaveLength(5);
  });

  test('a mint that yields no URL logs a failure, not a success', async () => {
    const failing = harness({ mediaUrl: null, reason: 'no-media-part' });

    const res = await request(failing.app).get('/proxy/plex/stream/694719');

    expect(res.status).toBe(404);
    expect(sampledCalls(failing.logger, 'plex.stream.mint')).toHaveLength(0);
    expect(failing.logger.warn).toHaveBeenCalledWith(
      'plex.stream.mint-failed',
      expect.objectContaining({ ratingKey: '694719', reason: 'no-media-part' }),
    );
  });

  test('a missing adapter is skipped, and says so', async () => {
    const app = express();
    const logger = { sampled: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const gateway = new RegistryPlaybackStreamGateway({ registry: { get: () => null }, logger });
    app.use('/proxy', createProxyRouter({ mintPlaybackStream: new MintPlaybackStream({ gateway }), logger }));

    const res = await request(app).get('/proxy/plex/stream/694719');

    expect(res.status).toBe(404);
    expect(logger.warn).toHaveBeenCalledWith(
      'plex.stream.mint-skipped',
      expect.objectContaining({ ratingKey: '694719', reason: 'no-plex-adapter' }),
    );
  });
});
