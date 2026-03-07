// tests/unit/suite/api/list-toListItem.test.mjs
import { describe, it, expect } from '@jest/globals';
import { toListItem } from '#api/v1/routers/list.mjs';

describe('toListItem', () => {
  it('emits launch action for items with actions.launch', () => {
    const item = {
      id: 'retroarch:n64/mario-kart-64',
      localId: 'n64/mario-kart-64',
      title: 'Mario Kart 64',
      type: 'game',
      metadata: { type: 'game', console: 'n64' },
      actions: {
        launch: { contentId: 'retroarch:n64/mario-kart-64' }
      }
    };

    const result = toListItem(item);

    expect(result.launch).toEqual({ contentId: 'retroarch:n64/mario-kart-64' });
    // Should NOT have play/queue/list since it's a launch item
    expect(result.play).toBeUndefined();
  });

  it('computes launch action for LaunchableItem-shaped items', () => {
    // When an item has isLaunchable() or launchIntent, toListItem should
    // compute a launch action even without explicit actions.launch
    const item = {
      id: 'retroarch:n64/mario-kart-64',
      localId: 'n64/mario-kart-64',
      title: 'Mario Kart 64',
      type: 'game',
      metadata: { type: 'game', console: 'n64' },
      launchIntent: { target: 'com.retroarch/Activity', params: {} }
    };

    const result = toListItem(item);

    expect(result.launch).toEqual({ contentId: 'retroarch:n64/mario-kart-64' });
  });

  it('does NOT add launch for normal playable items', () => {
    const item = {
      id: 'plex:12345',
      localId: '12345',
      title: 'Some Movie',
      type: 'movie',
      metadata: { type: 'movie' },
      mediaUrl: '/some/url'
    };

    const result = toListItem(item);

    expect(result.launch).toBeUndefined();
    expect(result.play).toBeDefined();
  });

  it('does NOT overwrite classified watchProgress with resumePosition', () => {
    const item = {
      id: 'plex:600174',
      localId: '600174',
      title: 'Eccentric Upper',
      type: 'episode',
      metadata: { type: 'episode' },
      mediaUrl: '/api/v1/proxy/plex/stream/600174',
      watchProgress: 100,
      watchSeconds: 1960,
      isWatched: true,
      lastPlayed: '2026-03-02',
      resumePosition: 338,
      duration: 1960
    };

    const result = toListItem(item);

    expect(result.watchProgress).toBe(100);
    expect(result.watchSeconds).toBe(1960);
    expect(result.resumePosition).toBe(338);
  });

  it('uses resumePosition for watchProgress when no classified value exists', () => {
    const item = {
      id: 'plex:99999',
      localId: '99999',
      title: 'Some Movie',
      type: 'movie',
      metadata: { type: 'movie' },
      mediaUrl: '/some/url',
      resumePosition: 600,
      duration: 3600
    };

    const result = toListItem(item);

    expect(result.watchProgress).toBe(17);
    expect(result.watchSeconds).toBe(600);
    expect(result.resumePosition).toBe(600);
  });
});
