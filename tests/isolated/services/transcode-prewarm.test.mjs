// tests/isolated/services/transcode-prewarm.test.mjs
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TranscodePrewarmService } from '../../../backend/src/3_applications/devices/services/TranscodePrewarmService.mjs';

// --- Helpers ---

const DASH_URL = 'http://plex.local/video/:/transcode/universal/start.mpd?session=abc123';
const RATING_KEY = '12345';
const CONTENT_ID = `plex:${RATING_KEY}`;
const CONTENT_REF = `plex:${RATING_KEY}`;

function mockAdapter({ resolvePlayables = true, loadMediaUrl = true } = {}) {
  return {
    resolvePlayables: resolvePlayables
      ? vi.fn().mockResolvedValue([{ contentId: CONTENT_ID, ratingKey: RATING_KEY, source: 'plex' }])
      : undefined,
    loadMediaUrl: loadMediaUrl
      ? vi.fn().mockResolvedValue(DASH_URL)
      : undefined,
  };
}

function mockContentIdResolver(opts = {}) {
  const adapter = opts.adapter !== undefined ? opts.adapter : mockAdapter();
  const resolved = opts.resolved !== undefined ? opts.resolved : {
    source: 'plex',
    localId: RATING_KEY,
    adapter,
  };
  return {
    resolve: vi.fn().mockReturnValue(resolved),
  };
}

function mockQueueService() {
  return {
    resolveQueue: vi.fn().mockImplementation(async (items) => items),
  };
}

function mockHttpClient() {
  return {
    get: vi.fn().mockResolvedValue({ status: 200 }),
  };
}

function mockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function buildService(overrides = {}) {
  return new TranscodePrewarmService({
    contentIdResolver: overrides.contentIdResolver ?? mockContentIdResolver(),
    queueService: overrides.queueService ?? mockQueueService(),
    httpClient: overrides.httpClient ?? mockHttpClient(),
    logger: overrides.logger ?? mockLogger(),
  });
}

// --- Tests ---

describe('TranscodePrewarmService', () => {
  describe('prewarm()', () => {
    test('returns token and contentId for a Plex queue', async () => {
      const svc = buildService();
      const result = await svc.prewarm(CONTENT_REF);

      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('contentId', CONTENT_ID);
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);
    });

    test('fetches start.mpd to warm transcode', async () => {
      const httpClient = mockHttpClient();
      const svc = buildService({ httpClient });
      await svc.prewarm(CONTENT_REF);

      // Allow the fire-and-forget fetch to settle
      await new Promise(r => setTimeout(r, 10));

      expect(httpClient.get).toHaveBeenCalledWith(DASH_URL);
    });

    test('returns skipped status for non-Plex content', async () => {
      const adapter = mockAdapter();
      const contentIdResolver = mockContentIdResolver({
        resolved: {
          source: 'youtube',
          localId: 'vid123',
          adapter,
        },
      });
      // resolveQueue returns item with non-plex source
      const queueService = {
        resolveQueue: vi.fn().mockResolvedValue([
          { contentId: 'youtube:vid123', source: 'youtube' },
        ]),
      };
      const svc = buildService({ contentIdResolver, queueService });
      const result = await svc.prewarm('youtube:vid123');

      expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'not plex' }));
    });

    test('returns skipped status when adapter resolution fails (no resolvePlayables)', async () => {
      const adapter = mockAdapter({ resolvePlayables: false });
      const contentIdResolver = mockContentIdResolver({ adapter });
      const svc = buildService({ contentIdResolver });
      const result = await svc.prewarm(CONTENT_REF);

      expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'no adapter' }));
    });

    test('returns failed status when loadMediaUrl returns null', async () => {
      const adapter = {
        resolvePlayables: vi.fn().mockResolvedValue([
          { contentId: CONTENT_ID, ratingKey: RATING_KEY, source: 'plex' },
        ]),
        loadMediaUrl: vi.fn().mockResolvedValue(null),
      };
      const contentIdResolver = mockContentIdResolver({ adapter });
      const svc = buildService({ contentIdResolver });
      const result = await svc.prewarm(CONTENT_REF);

      expect(result).toEqual(expect.objectContaining({
        status: 'failed',
        reason: 'loadMediaUrl returned null',
      }));
    });
  });

  describe('redeem()', () => {
    test('redeems token for cached DASH URL', async () => {
      const svc = buildService();
      const { token } = await svc.prewarm(CONTENT_REF);
      const url = svc.redeem(token);

      expect(url).toBe(DASH_URL);
    });

    test('returns null for unknown token', () => {
      const svc = buildService();
      const url = svc.redeem('totally-unknown-token');

      expect(url).toBeNull();
    });

    test('token is single-use (second redeem returns null)', async () => {
      const svc = buildService();
      const { token } = await svc.prewarm(CONTENT_REF);

      const first = svc.redeem(token);
      const second = svc.redeem(token);

      expect(first).toBe(DASH_URL);
      expect(second).toBeNull();
    });
  });
});
