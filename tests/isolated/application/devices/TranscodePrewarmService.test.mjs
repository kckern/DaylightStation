import { jest } from '@jest/globals';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('TranscodePrewarmService return shape', () => {
  test('returns { status: "skipped", reason: "no adapter" } when resolver has no adapter', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter: null }) },
      queueService: { resolveQueue: jest.fn() },
      httpClient: { get: jest.fn() },
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
          adapter: { resolvePlayables: jest.fn().mockResolvedValue([]) }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([]) },
      httpClient: { get: jest.fn() },
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
          adapter: { resolvePlayables: jest.fn(), loadMediaUrl: null }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'poem', contentId: 'poem:remedy/01' }]) },
      httpClient: { get: jest.fn() },
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
            resolvePlayables: jest.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: jest.fn().mockResolvedValue(null)
          }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
      httpClient: { get: jest.fn() },
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
            resolvePlayables: jest.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: jest.fn().mockResolvedValue('https://example/mpd')
          }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
      httpClient: { get: jest.fn().mockResolvedValue({}) },
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
      queueService: { resolveQueue: jest.fn() },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('exception');
    expect(result.error).toBe('boom');
  });
});
