import { describe, it, expect, vi } from 'vitest';
import { FreshVideoAdapter } from '#adapters/content/freshvideo/FreshVideoAdapter.mjs';

// Helper: create mock FileAdapter that returns video items for a folder
function makeMockFileAdapter(items) {
  return {
    getList: vi.fn(async () => items.map(f => ({ localId: f, itemType: 'leaf' }))),
    getItem: vi.fn(async (localId) => ({
      id: `files:${localId}`,
      localId,
      title: localId.split('/').pop(),
      source: 'files',
      mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(localId)}`,
      metadata: {},
    })),
  };
}

function makeMockProgress(watchedKeys = []) {
  return {
    get: vi.fn(async (key) => {
      const percent = watchedKeys.includes(key) ? 95 : 0;
      return { percent };
    }),
  };
}

describe('FreshVideoAdapter', () => {
  it('returns the latest unwatched video', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress([]),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe('video/news/teded/20260127.mp4');
  });

  it('skips watched videos and returns next unwatched', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress(['video/news/teded/20260127.mp4']),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe('video/news/teded/20260122.mp4');
  });

  it('falls back to newest when all watched', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress([
        'video/news/teded/20260122.mp4',
        'video/news/teded/20260127.mp4',
      ]),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    // Falls back to newest (never empty)
    expect(result[0].localId).toBe('video/news/teded/20260127.mp4');
  });

  it('returns empty only when folder has no videos', async () => {
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter([]),
      mediaProgressMemory: makeMockProgress([]),
    });

    const result = await adapter.resolvePlayables('teded');
    expect(result).toHaveLength(0);
  });

  it('has source "freshvideo" and prefix "freshvideo"', () => {
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter([]),
      mediaProgressMemory: makeMockProgress([]),
    });

    expect(adapter.source).toBe('freshvideo');
    expect(adapter.prefixes).toEqual([{ prefix: 'freshvideo' }]);
  });
});
