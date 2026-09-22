import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createContentRegistry } from '#composition/bootstrap.mjs';
import { createApiRouters } from '#composition/modules/contentApi.mjs';
import { LibbyStreamLeaseService } from '#adapters/content/media/libby/LibbyStreamLeaseService.mjs';

describe('Libby browser playback flow', () => {
  it('resolves an explicit active loan to an opaque same-origin audio stream', async () => {
    const loan = {
      cardId: '123456789', titleId: '9999999', title: 'Fixture Book', author: 'Fixture Author',
      expiresAt: Date.now() + 60_000,
      parts: [{ key: 'part-001', index: 0, title: 'Part 1', duration: 12,
        mimeType: 'audio/mpeg', upstreamUrl: 'https://fixture.listen.libbyapp.com/part.mp3', headers: {} }],
    };
    const leases = new LibbyStreamLeaseService();
    const client = { openLoan: vi.fn(async () => loan) };
    const { registry } = createContentRegistry({ libby: { username: 'reader' } }, {
      libbyClient: client, libbyLeaseService: leases,
    });
    const libbyStreamService = {
      open: vi.fn(async ({ handle }) => {
        expect(leases.resolve(handle).kind).toBe('found');
        return {
          kind: 'opened', status: 200, contentType: 'audio/mpeg', contentLength: '1',
          body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); } }),
          cleanup: vi.fn(),
        };
      }),
    };
    const configService = {
      getAppConfig: () => ({}), getHouseholdAppConfig: () => ({}),
      reloadHouseholdAppConfig: () => ({}), getStreamingProfiles: () => [],
    };
    const { routers } = createApiRouters({
      registry,
      mediaProgressMemory: { findProgress: async () => null },
      menuMemoryRepository: { load: () => ({}), save: () => undefined },
      dataPath: '/tmp/libby-flow-data', mediaBasePath: '/tmp/libby-flow-media',
      configService, libbyStreamService,
      logger: { child() { return this; }, debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const app = express();
    app.use('/api/v1/play', routers.play);
    app.use('/api/v1/proxy', routers.proxy);

    const play = await request(app).get('/api/v1/play/libby/loan/123456789/9999999');
    expect(play.status).toBe(200);
    expect(play.body).toMatchObject({
      id: 'libby:loan/123456789/9999999/part/part-001',
      mediaType: 'audio', resumable: true,
    });
    expect(play.body.mediaUrl).toMatch(/^\/api\/v1\/proxy\/libby\/stream\/[A-Za-z0-9_-]+$/);
    expect(play.body.mediaUrl).not.toContain('listen.libbyapp.com');

    const audio = await request(app).get(play.body.mediaUrl);
    expect(audio.status).toBe(200);
    expect(audio.headers['cache-control']).toBe('private, no-store');
    expect(audio.body).toEqual(Buffer.from('A'));
  });
});
