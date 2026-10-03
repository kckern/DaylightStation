import { describe, it, expect } from 'vitest';
import { CompositeNowPlayingReader } from './CompositeNowPlayingReader.mjs';

describe('CompositeNowPlayingReader', () => {
  it('merges readers, first reader wins per device, and survives one failing', async () => {
    const reader = new CompositeNowPlayingReader([
      { list: async () => [{ deviceId: 'fleet:tv', screenId: 'tv', contentId: 'plex:1', state: 'paused', position: 5 }] },
      { list: async () => { throw new Error('boom'); } },
      { list: () => [
        { deviceId: 'fleet:tv', screenId: 'tv', contentId: 'plex:1', state: 'playing', position: null },
        { deviceId: 'browser:kid', screenId: null, contentId: 'plex:2', state: 'playing', position: null },
      ] },
    ]);
    expect(await reader.list()).toEqual([
      { deviceId: 'fleet:tv', screenId: 'tv', contentId: 'plex:1', state: 'paused', position: 5 },
      { deviceId: 'browser:kid', screenId: null, contentId: 'plex:2', state: 'playing', position: null },
    ]);
  });
  it('throws only when every reader fails (so the caller reports "unknown")', async () => {
    const reader = new CompositeNowPlayingReader([{ list: async () => { throw new Error('a'); } }]);
    await expect(reader.list()).rejects.toThrow();
  });
});
