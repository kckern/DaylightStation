// An ordered work (a book) comes back from the queue in its own order with
// `startIndex`; the prewarm prepares the part the screen will start at.
import { describe, expect, it, vi } from 'vitest';
import { TranscodePrewarmService } from './TranscodePrewarmService.mjs';

function build(queue) {
  const contentCatalog = {
    resolvePlayables: vi.fn(async () => [...queue]),
    preparePlayback: vi.fn(async () => ({ kind: 'ready', url: '/proxy/plex/decided.mpd' })),
  };
  const service = new TranscodePrewarmService({
    contentIdResolver: { resolve: () => ({ source: 'plex', localId: '727787' }) },
    contentCatalog,
    queueService: { resolveQueue: vi.fn(async () => queue) },
    httpClient: { get: vi.fn(async () => ({})) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    clock: { now: () => 1_000_000 },
    createToken: () => 'token1',
    scheduler: { after: () => () => {} },
  });
  return { service, contentCatalog };
}

describe('TranscodePrewarmService — ordered work start', () => {
  it('prepares the item at startIndex, from its resume position', async () => {
    const parts = [1, 2, 3].map((n) => ({ id: `plex:${n}`, source: 'plex', resumePosition: n === 2 ? 600 : 0 }));
    const { service, contentCatalog } = build(Object.assign(parts, { startIndex: 1 }));
    const result = await service.prewarm('plex:727787', { deviceId: 'office-tv' });
    expect(result).toMatchObject({ status: 'ok', contentId: 'plex:2', queueContentIds: ['plex:1', 'plex:2', 'plex:3'] });
    expect(contentCatalog.preparePlayback).toHaveBeenCalledWith(expect.anything(), parts[1], { startOffset: 600 });
  });

  it('without startIndex prepares the first item, as before', async () => {
    const parts = [1, 2].map((n) => ({ id: `plex:${n}`, source: 'plex' }));
    const { service } = build(parts);
    const result = await service.prewarm('plex:727787', { deviceId: 'office-tv' });
    expect(result).toMatchObject({ status: 'ok', contentId: 'plex:1' });
  });
});
