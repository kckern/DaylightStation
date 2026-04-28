import { vi } from 'vitest';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'poem',
          localId: 'remedy',
          adapter: { resolvePlayables: vi.fn(), loadMediaUrl: null }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([{ source: 'poem', contentId: 'poem:remedy/01' }]) },
      httpClient: { get: vi.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('poem:remedy');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'not plex' }));
  });

  test('returns { status: "failed", reason: "loadMediaUrl returned null" } when adapter returns null', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: vi.fn().mockResolvedValue(null)
          }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
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
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: vi.fn().mockResolvedValue({ url: 'https://example/mpd' })
          }
        })
      },
      queueService: { resolveQueue: vi.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
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
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', ratingKey: '1', source: 'plex' }]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'metadata-missing' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { request: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('metadata-missing');
    expect(result.permanent).toBe(true);
  });

  it('marks permanent: false when adapter returns reason="transient"', async () => {
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', ratingKey: '1', source: 'plex' }]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'transient' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { request: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('transient');
    expect(result.permanent).toBe(false);
  });
});
