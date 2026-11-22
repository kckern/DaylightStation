// App items queued from a list carry that list item's params to the opened app.
import { describe, it, expect } from 'vitest';
import { toQueueItem } from './queue.mjs';

const appItem = (extra = {}) => ({ id: 'app:party-games/charades:fhe', title: 'Charades', source: 'app', mediaUrl: null, mediaType: 'app', format: 'app', metadata: { contentFormat: 'app' }, ...extra });

describe('toQueueItem params', () => {
  it('keeps params on an app queue item', () => {
    expect(toQueueItem(appItem({ params: { autostart: true } })).params).toEqual({ autostart: true });
  });

  it('has no params key when the app item has none', () => {
    expect('params' in toQueueItem(appItem())).toBe(false);
  });

  it('does not copy params onto a non-app queue item', () => {
    const qi = toQueueItem({ id: 'plex:1', title: 'One', source: 'plex', mediaUrl: '/m/1', mediaType: 'video', metadata: {}, params: { x: 1 } });
    expect('params' in qi).toBe(false);
  });
});
