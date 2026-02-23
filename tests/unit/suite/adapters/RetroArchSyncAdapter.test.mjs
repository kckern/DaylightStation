// tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetroArchSyncAdapter } from '#adapters/content/retroarch/RetroArchSyncAdapter.mjs';

const MOCK_PLAYLIST = {
  items: [
    {
      path: '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64',
      label: 'Mario Kart 64 (USA)',
      core_path: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so',
      crc32: 'DEADBEEF'
    },
    {
      path: '/storage/emulated/0/Games/N64/Star Fox 64 (USA).n64',
      label: 'Star Fox 64 (USA)',
      core_path: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so',
      crc32: '12345678'
    }
  ]
};

describe('RetroArchSyncAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockWriteCatalog;
  let mockReadCatalog;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn()
        // First call: directory listing
        .mockResolvedValueOnce({
          data: [{ name: 'Nintendo 64.lpl', type: 'file' }]
        })
        // Second call: playlist content
        .mockResolvedValueOnce({ data: MOCK_PLAYLIST })
    };

    mockReadCatalog = jest.fn().mockReturnValue({
      sync: {},
      games: {},
      overrides: { 'n64/mario-kart-64': { title: 'MK64 Custom' } }
    });

    mockWriteCatalog = jest.fn();

    adapter = new RetroArchSyncAdapter({
      sourceConfig: { host: '10.0.0.11', port: 1111, playlists_path: '/storage/emulated/0/RetroArch/playlists' },
      consoleConfig: {
        n64: { label: 'Nintendo 64', core: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so' }
      },
      thumbnailBasePath: '/data/retroarch/thumbnails',
      httpClient: mockHttpClient,
      readCatalog: mockReadCatalog,
      writeCatalog: mockWriteCatalog,
      downloadThumbnail: jest.fn().mockResolvedValue(true),
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('sync', () => {
    it('fetches playlists, parses games, preserves overrides, and writes catalog', async () => {
      const result = await adapter.sync();

      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
      expect(mockWriteCatalog).toHaveBeenCalledTimes(1);

      const writtenCatalog = mockWriteCatalog.mock.calls[0][0];
      expect(writtenCatalog.games.n64).toHaveLength(2);
      expect(writtenCatalog.games.n64[0].id).toBe('mario-kart-64-usa');
      expect(writtenCatalog.overrides).toEqual({ 'n64/mario-kart-64': { title: 'MK64 Custom' } });
      expect(writtenCatalog.sync.game_count).toBe(2);
      expect(result.synced).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('returns sync status from catalog', async () => {
      mockReadCatalog.mockReturnValue({
        sync: { last_synced: '2026-02-23T10:00:00Z', game_count: 30 },
        games: {}, overrides: {}
      });

      const status = await adapter.getStatus();
      expect(status).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });

    it('returns null/zero when no catalog exists', async () => {
      mockReadCatalog.mockReturnValue(null);
      const status = await adapter.getStatus();
      expect(status).toEqual({ lastSynced: null, itemCount: 0 });
    });
  });
});
