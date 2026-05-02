import { vi } from 'vitest';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePlexPlayable(localId = '1') {
  return new PlayableItem({
    id: `plex:${localId}`,
    source: 'plex',
    localId: String(localId),
    title: 'Test',
    mediaType: 'audio',
    mediaUrl: `/api/v1/proxy/plex/stream/${localId}`,
    duration: 200,
    resumable: false,
    metadata: { type: 'track', Media: [{ Part: [{ key: '/p/1.mp3' }] }] },
  });
}

function makePoemPlayable() {
  return new PlayableItem({
    id: 'poem:remedy/01',
    source: 'poem',
    localId: 'remedy/01',
    title: 'Test Poem',
    mediaType: 'audio',
    mediaUrl: '/api/v1/proxy/local/poem/remedy/01.mp3',
    duration: 60,
    resumable: false,
  });
}

describe('TranscodePrewarmService return shape', () => {
  test('returns { status: "skipped", reason: "no adapter" } when resolver has no adapter', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter: null }) },
      queueService: { resolveQueue: vi.fn() },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'no adapter' }));
  });

  test('returns { status: "skipped", reason: "empty queue" } when queue resolves to nothing', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: { resolvePlayables: vi.fn().mockResolvedValue([]) }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([]) },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'empty queue' }));
  });

  test('returns { status: "skipped", reason: "not plex" } for non-Plex sources', async () => {
    const poemPlayable = makePoemPlayable();
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'poem',
          localId: 'remedy',
          adapter: { resolvePlayables: vi.fn().mockResolvedValue([poemPlayable]), loadMediaUrl: null }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([poemPlayable]) },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('poem:remedy');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'not plex' }));
  });

  test('returns { status: "failed", reason: "loadMediaUrl returned null" } when adapter returns null', async () => {
    const playable = makePlexPlayable();
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([playable]),
            loadMediaUrl: vi.fn().mockResolvedValue(null)
          }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([playable]) },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      reason: 'loadMediaUrl returned null'
    }));
  });

  test('returns { status: "ok", token, contentId } on success', async () => {
    const playable = makePlexPlayable();
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([playable]),
            loadMediaUrl: vi.fn().mockResolvedValue({ url: 'https://example/mpd' })
          }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([playable]) },
      httpClient: { get: vi.fn().mockResolvedValue({}) },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('ok');
    expect(result.token).toEqual(expect.any(String));
    expect(result.contentId).toBe('plex:1');
  });

  test('returns { status: "failed", reason: "exception" } on thrown error', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => { throw new Error('boom'); } },
      queueService: { resolveQueue: vi.fn() },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('exception');
    expect(result.error).toBe('boom');
  });
});

describe('TranscodePrewarmService — permanent vs transient failure', () => {
  it('marks permanent: true when adapter returns reason="metadata-missing"', async () => {
    const playable = makePlexPlayable();
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([playable]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'metadata-missing' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { get: vi.fn() },
      logger: makeLogger(),
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('metadata-missing');
    expect(result.permanent).toBe(true);
  });

  it('marks permanent: false when adapter returns reason="transient"', async () => {
    const playable = makePlexPlayable();
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([playable]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'transient' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { get: vi.fn() },
      logger: makeLogger(),
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('transient');
    expect(result.permanent).toBe(false);
  });

  it('marks permanent: false for an unrecognized reason string', async () => {
    const playable = makePlexPlayable();
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([playable]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'banana' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { get: vi.fn() },
      logger: makeLogger(),
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('banana');
    expect(result.permanent).toBe(false);
  });
});
