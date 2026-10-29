import { describe, it, expect } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

const bare = () => Object.create(PlexAdapter.prototype);

describe('PlexAdapter next-up categorization', () => {
  it('treats a skipped entry as watched, not in progress', () => {
    const log = { a: { percent: 1, playhead: 37, duration: 3600, skipped: true }, b: {} };
    expect(bare()._categorizeByWatchStatus(['a', 'b'], log))
      .toEqual({ watched: ['a'], inProgress: [], unwatched: ['b'] });
  });

  it('carries skipped through the viewing-history load', async () => {
    const adapter = bare();
    adapter.mediaProgressMemory = {
      listProgress: async () => [{ contentId: 'plex:5', playhead: 37, duration: 3600, percent: 1, lastPlayed: null, skipped: true }],
    };
    const log = await adapter._loadViewingHistoryAsync('plex/17_lectures');
    expect(log['5'].skipped).toBe(true);
  });
});
