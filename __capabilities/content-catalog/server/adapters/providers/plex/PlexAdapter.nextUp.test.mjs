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

// A stub Plex tree: containers list children, leaves are playable episodes.
function treeAdapter(tree, log) {
  const adapter = bare();
  adapter.logger = { debug() {}, info() {}, warn() {}, error() {} };
  adapter.getItem = async (key) => (tree[key]
    ? { id: `plex:${key}`, metadata: { type: 'season' } }
    : { id: `plex:${key}`, mediaUrl: `/m/${key}`, metadata: { type: 'episode' } });
  adapter.getList = async (key) => (tree[key] || []).map(k => ({
    id: `plex:${k}`, itemType: tree[k] ? 'container' : 'leaf',
  }));
  adapter._loadViewingHistoryAsync = async () => log;
  return adapter;
}
const done = { percent: 100, playhead: 1800, duration: 1800 };

describe('PlexAdapter.loadPlayableItemFromKey across containers', () => {
  it('walks past a finished season to the next one with something left', async () => {
    const adapter = treeAdapter({ S: ['s1', 's2'], s1: ['e1', 'e2'], s2: ['e3', 'e4'] },
      { e1: done, e2: done, e3: done });
    const pick = await adapter.loadPlayableItemFromKey('S');
    expect(pick.id).toBe('plex:e4');
    expect(pick.restarted).toBeFalsy();
  });

  it('a fully finished show restarts at the top, marked restarted', async () => {
    const adapter = treeAdapter({ S: ['s1', 's2'], s1: ['e1'], s2: ['e2'] }, { e1: done, e2: done });
    const pick = await adapter.loadPlayableItemFromKey('S');
    expect(pick.id).toBe('plex:e1');
    expect(pick.restarted).toBe(true);
  });

  it('a season whose only leftover was skipped counts as finished (restart, not in-progress)', async () => {
    const adapter = treeAdapter({ s1: ['e1', 'e2'] },
      { e1: { percent: 1, playhead: 37, duration: 3600, skipped: true }, e2: done });
    const pick = await adapter.loadPlayableItemFromKey('s1');
    expect(pick.restarted).toBe(true);
  });

  it('an unfinished season picks normally, not restarted', async () => {
    const adapter = treeAdapter({ s1: ['e1', 'e2'] }, { e1: done });
    const pick = await adapter.loadPlayableItemFromKey('s1');
    expect(pick.id).toBe('plex:e2');
    expect(pick.restarted).toBeFalsy();
  });
});
