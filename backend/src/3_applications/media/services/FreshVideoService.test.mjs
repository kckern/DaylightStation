import { describe, expect, it, vi } from 'vitest';
import { FreshVideoService } from './FreshVideoService.mjs';

describe('FreshVideoService semantic video boundary', () => {
  it('passes no host directory to the gateway and keeps resources opaque', async () => {
    const gateway = {
      downloadLatest: vi.fn(async () => ({
        kind: 'downloaded', assetId: 'bbc:20260828', uploadDate: '20260828',
      })),
    };
    const mediaStore = {
      acquireRunLock: vi.fn(() => vi.fn()),
      cleanupOlderThan: vi.fn(() => []),
      cleanupInvalid: vi.fn(() => 0),
      ensureProvider: vi.fn(),
      loadProviderMetadata: vi.fn(() => ({ title: 'BBC' })),
      saveProviderMetadata: vi.fn(),
      findDatedVideo: vi.fn()
        .mockReturnValueOnce(null)
        .mockImplementation((provider, date) => ({ provider, date })),
      listVideosSince: vi.fn(() => [{ provider: 'bbc', date: '20260828' }]),
    };
    const service = new FreshVideoService({
      videoSourceGateway: gateway,
      configLoader: async () => [{ provider: 'bbc', sourceRef: { opaque: true } }],
      mediaStore,
      lockOwnerId: 42,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });

    const result = await service.run();

    expect(gateway.downloadLatest).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'bbc' }),
      expect.not.objectContaining({ outputDir: expect.anything() }),
    );
    expect(mediaStore.ensureProvider).toHaveBeenCalledWith('bbc');
    expect(result.results[0]).toMatchObject({
      provider: 'bbc', success: true, resource: { provider: 'bbc', date: '20260828' },
    });
    expect(result.results[0]).not.toHaveProperty('filePath');
  });
});
