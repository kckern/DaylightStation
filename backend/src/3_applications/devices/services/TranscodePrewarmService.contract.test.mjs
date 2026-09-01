import { describe, expect, it, vi } from 'vitest';
import { TranscodePrewarmService } from './TranscodePrewarmService.mjs';

describe('TranscodePrewarmService dependency contract', () => {
  it('rejects a missing content catalog during construction', () => {
    expect(() => new TranscodePrewarmService({
      contentIdResolver: { resolve: vi.fn() },
      queueService: { resolveQueue: vi.fn() },
      httpClient: { get: vi.fn() },
      clock: { now: () => 1_700_000_000_000 },
      createToken: () => 'testtoken0000000',
      scheduler: { after: () => () => {} },
    })).toThrow('TranscodePrewarmService requires contentIdResolver, contentCatalog, queueService, and httpClient');
  });
});

describe('TranscodePrewarmService semantic unsupported result', () => {
  it('preserves the public skip reason supplied by the content boundary', async () => {
    const item = { id: 'poem:remedy/01', source: 'poem' };
    const service = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({ source: 'poem', localId: 'remedy/01' }),
      },
      contentCatalog: {
        resolvePlayables: vi.fn(async () => [item]),
        preparePlayback: vi.fn(async () => ({ kind: 'unsupported', reason: 'not plex' })),
      },
      queueService: { resolveQueue: vi.fn(async () => [item]) },
      httpClient: { get: vi.fn() },
      clock: { now: () => 1_700_000_000_000 },
      createToken: () => 'testtoken0000000',
      scheduler: { after: () => () => {} },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    await expect(service.prewarm('poem:remedy/01')).resolves.toEqual({
      status: 'skipped',
      reason: 'not plex',
    });
  });
});
