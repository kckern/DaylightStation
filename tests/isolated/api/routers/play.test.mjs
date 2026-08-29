// tests/unit/api/routers/play.test.mjs
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#backend/src/4_api/v1/routers/play.mjs';
import { PlaybackReadService } from '#apps/content/services/PlaybackReadService.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';

describe('Play API Router', () => {
  let app;
  let mockRegistry;
  let mockWatchStore;
  let mockMediaAdapter;
  let mockPlexAdapter;
  let mockPlayResponseService;

  beforeEach(() => {
    mockMediaAdapter = {
      name: 'files',
      getItem: vi.fn().mockResolvedValue({
        id: 'files:audio/test.mp3',
        title: 'Test Song',
        mediaType: 'audio',
        mediaUrl: '/proxy/media/stream/audio/test.mp3',
        duration: 180,
        resumable: false
      }),
      getStoragePath: vi.fn().mockReturnValue('files'),
      resolvePlayables: vi.fn()
    };

    mockPlexAdapter = {
      name: 'plex',
      getItem: vi.fn().mockResolvedValue({
        id: 'plex:12345',
        title: 'Test Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true
      }),
      getStoragePath: vi.fn().mockReturnValue('plex'),
      resolvePlayables: vi.fn()
    };

    mockRegistry = {
      get: vi.fn((name) => {
        if (name === 'files') return mockMediaAdapter;
        if (name === 'plex') return mockPlexAdapter;
        return null;
      })
    };

    mockWatchStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined)
    };

    // Production refactored play.mjs to delegate response shaping to PlayResponseService and to
    // require mediaProgressMemory directly. Provide minimal stubs so existing tests pass through.
    const mockMediaProgressMemory = {
      get: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
    };
    mockPlayResponseService = {
      getWatchState: vi.fn(async (item) => {
        // Production now sources watch state via playResponseService; bridge
        // through to mockWatchStore so existing test cases that stub
        // mockWatchStore.get continue to drive resume_position behavior.
        return await mockWatchStore.get(item.id);
      }),
      toPlayResponse: vi.fn((item, watchState, { resume } = {}) => {
        const colon = item.id.indexOf(':');
        const source = colon >= 0 ? item.id.substring(0, colon) : null;
        const localId = colon >= 0 ? item.id.substring(colon + 1) : item.id;
        const out = {
          id: item.id,
          assetId: item.id,
          mediaUrl: item.mediaUrl,
          mediaType: item.mediaType,
          title: item.title,
          duration: item.duration,
          resumable: item.resumable ?? false,
        };
        // Mirror production's `resume` gate (PlayResponseService.toPlayResponse):
        // an explicit resume:false suppresses resume_position (and, in
        // production, the Plex stream `offset=` rewrite) even when watch
        // state has a stored playhead.
        if (resume !== false && watchState?.playhead != null) out.resume_position = watchState.playhead;
        // Mirror the production response shape that includes a per-source
        // identifier alias (e.g. plex: '12345').
        if (source) out[source] = localId;
        return out;
      }),
    };

    // Production play router routes through ContentIdResolver. Provide a
    // minimal resolver that mirrors the registry-based lookup the test
    // setup expects.
    const mockContentIdResolver = {
      resolve: vi.fn((compoundId) => {
        const colon = compoundId.indexOf(':');
        const source = colon >= 0 ? compoundId.substring(0, colon) : compoundId;
        const localId = colon >= 0 ? compoundId.substring(colon + 1) : '';
        const adapter = mockRegistry.get(source);
        if (!adapter) return null;
        return { adapter, localId, source };
      })
    };

    app = express();
    const contentCatalog = new RegistryContentCatalogGateway({ registry: mockRegistry });
    app.use('/api/play', createPlayRouter({
      playbackReadService: new PlaybackReadService({
        contentCatalog,
        playResponseService: mockPlayResponseService,
        contentIdResolver: mockContentIdResolver,
      }),
    }));
  });

  describe('GET /api/play/:source/*', () => {
    it('returns playable item from files', async () => {
      const res = await request(app).get('/api/play/files/audio/test.mp3');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('files:audio/test.mp3');
      expect(res.body.mediaUrl).toBe('/proxy/media/stream/audio/test.mp3');
      expect(res.body.mediaType).toBe('audio');
    });

    it('returns playable item from plex', async () => {
      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('plex:12345');
      expect(res.body.mediaUrl).toBe('/proxy/plex/stream/12345');
      expect(res.body.mediaType).toBe('video');
    });

    it('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/play/unknown/12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Unknown source');
    });

    it('returns 404 for missing item', async () => {
      mockMediaAdapter.getItem.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/play/files/nonexistent.mp3');

      expect(res.status).toBe(404);
    });

    it('includes resume position when item is in progress', async () => {
      mockWatchStore.get.mockResolvedValueOnce({
        contentId: 'plex:12345',
        playhead: 3600,
        duration: 7200,
        isInProgress: () => true,
        isWatched: () => false
      });

      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBe(3600);
    });

    it('includes plex field for plex items', async () => {
      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.plex).toBe('12345');
    });
  });

  describe('GET /api/play/:source/*/shuffle', () => {
    it('handles shuffle modifier in path', async () => {
      mockMediaAdapter.resolvePlayables.mockResolvedValue([
        { id: 'files:audio/song1.mp3', title: 'Song 1', mediaUrl: '/proxy/media/stream/audio/song1.mp3', mediaType: 'audio' },
        { id: 'files:audio/song2.mp3', title: 'Song 2', mediaUrl: '/proxy/media/stream/audio/song2.mp3', mediaType: 'audio' }
      ]);

      const res = await request(app).get('/api/play/files/audio/shuffle');

      expect(res.status).toBe(200);
      expect(mockMediaAdapter.resolvePlayables).toHaveBeenCalled();
    });

    it('returns 404 when shuffle finds no playables', async () => {
      mockMediaAdapter.resolvePlayables.mockResolvedValue([]);

      const res = await request(app).get('/api/play/files/audio/shuffle');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No playable items found');
    });
  });

  // Karaoke/play-along content ids are bare compound ids (e.g. `plex:662039`,
  // no trailing path segment) and are served by the `/:source` route below,
  // NOT `/:source/*splat` above. Regression coverage: this route must forward
  // `?resume=false` exactly like the splat route already does, and must leave
  // normal (non-karaoke) resume behavior untouched when the param is absent.
  describe('GET /api/play/:source (bare compound id)', () => {
    it('omits resume_position when ?resume=false, even with a stored playhead', async () => {
      mockWatchStore.get.mockResolvedValueOnce({
        contentId: 'plex:12345',
        playhead: 3600,
        duration: 7200,
        isInProgress: () => true,
        isWatched: () => false
      });

      const res = await request(app).get('/api/play/plex:12345?resume=false');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBeUndefined();
      // Prove the router actually forwarded the override, not just that the
      // mock happened to omit it.
      const call = mockPlayResponseService.toPlayResponse.mock.calls.at(-1);
      expect(call[2]).toMatchObject({ resume: false });
    });

    it('includes resume_position by default (regression: normal resume unaffected)', async () => {
      mockWatchStore.get.mockResolvedValueOnce({
        contentId: 'plex:12345',
        playhead: 3600,
        duration: 7200,
        isInProgress: () => true,
        isWatched: () => false
      });

      const res = await request(app).get('/api/play/plex:12345');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBe(3600);
      const call = mockPlayResponseService.toPlayResponse.mock.calls.at(-1);
      expect(call[2]?.resume).toBeUndefined();
    });
  });
});
