import { describe, it, expect } from 'vitest';
import { LivenessNowPlayingReader, ACTIVE_STATES } from './LivenessNowPlayingReader.mjs';

function liveness(entries) {
  return {
    knownDeviceIds: () => Object.keys(entries),
    getLastSnapshot: (id) => entries[id] || null,
  };
}

describe('LivenessNowPlayingReader', () => {
  it('lists online screens with an item on them, keyed as spot device ids', async () => {
    const reader = new LivenessNowPlayingReader({ livenessService: liveness({
      'livingroom-tv': { online: true, snapshot: { state: 'playing', position: 120, currentItem: { contentId: 'plex:1', title: 'Film' } } },
      'office-tv': { online: true, snapshot: { state: 'paused', position: 5, currentItem: { contentId: 'plex:2' } } },
      'idle-tv': { online: true, snapshot: { state: 'idle', currentItem: null } },
      'ended-tv': { online: true, snapshot: { state: 'ended', currentItem: { contentId: 'plex:3' } } },
      'gone-tv': { online: false, snapshot: { state: 'playing', currentItem: { contentId: 'plex:4' } } },
    }) });
    expect(await reader.list()).toEqual([
      { deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', contentId: 'plex:1', state: 'playing', position: 120 },
      { deviceId: 'fleet:office-tv', screenId: 'office-tv', contentId: 'plex:2', state: 'paused', position: 5 },
    ]);
  });
  it('counts paused as on the screen', () => {
    expect(ACTIVE_STATES).toEqual(expect.arrayContaining(['playing', 'paused', 'buffering', 'loading', 'stalled']));
  });
});
