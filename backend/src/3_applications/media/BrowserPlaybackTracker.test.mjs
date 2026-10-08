import { describe, it, expect } from 'vitest';
import { BrowserPlaybackTracker } from './BrowserPlaybackTracker.mjs';

describe('BrowserPlaybackTracker', () => {
  it('keeps the last frame per browser and lists the ones playing', () => {
    let now = 1000;
    const t = new BrowserPlaybackTracker({ clock: { now: () => now }, ttlMs: 100 });
    t.observe({ deviceId: 'browser:a', state: 'playing', contentId: 'plex:1', origin: { kind: 'routine', name: 'R' } });
    t.observe({ deviceId: 'browser:b', state: 'idle', contentId: null });
    expect(t.get('browser:a')).toMatchObject({ contentId: 'plex:1', origin: { kind: 'routine', name: 'R' } });
    expect(t.list().map((e) => e.deviceId)).toEqual(['browser:a']);
    now += 101;
    expect(t.get('browser:a')).toBeNull();
    expect(t.list()).toEqual([]);
  });
});
