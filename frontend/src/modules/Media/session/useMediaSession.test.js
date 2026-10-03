// Lock-screen and system controls for playback on this device (STEER.1a/AC5,
// RQ-STEER-04): metadata, artwork, play/pause/next/prev/seek, position.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindMediaSession, mediaSessionMetadata } from './useMediaSession.js';
import { createLocalSessionController } from './LocalSessionController.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function fakeMediaSession() {
  const handlers = new Map();
  return {
    handlers,
    metadata: undefined,
    playbackState: 'none',
    setActionHandler: vi.fn((action, fn) => { if (fn) handlers.set(action, fn); else handlers.delete(action); }),
    setPositionState: vi.fn(),
  };
}
class FakeMetadata { constructor(init) { Object.assign(this, init); } }

function controller() {
  const c = createLocalSessionController({ clientId: 'ms', sessionControls: { storage: null } });
  c.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe('Media Session binding', () => {
  it('publishes title, show, artwork and state for the current item', () => {
    const ms = fakeMediaSession();
    const c = controller();
    bindMediaSession(c, { mediaSession: ms, MediaMetadataCtor: FakeMetadata });
    expect(ms.metadata).toBeNull();
    c.queue.playNow({ contentId: 'plex:1', title: 'Hospital', format: 'video', duration: 420, thumbnail: '/thumb/1', containerTitle: 'Bluey' });
    expect(ms.metadata).toMatchObject({ title: 'Hospital', artist: 'Bluey', artwork: [{ src: expect.stringMatching(/\/thumb\/1$/) }] });
    c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    expect(ms.playbackState).toBe('playing');
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 420, position: 0, playbackRate: 1 });
  });

  it('routes system presses to the same session controls, and logs them', () => {
    const ms = fakeMediaSession();
    const c = controller();
    c.queue.playNow({ contentId: 'plex:1', title: 'One', format: 'audio', duration: 200 });
    c.queue.add({ contentId: 'plex:2', title: 'Two', format: 'audio', duration: 200 });
    bindMediaSession(c, { mediaSession: ms, MediaMetadataCtor: FakeMetadata });
    expect([...ms.handlers.keys()].sort()).toEqual(['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward', 'seekforward', 'seekto', 'stop']);
    ms.handlers.get('nexttrack')();
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:2');
    ms.handlers.get('previoustrack')();
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:1');
    const seek = vi.spyOn(c.transport, 'seekAbs');
    ms.handlers.get('seekto')({ seekTime: 42 });
    expect(seek).toHaveBeenCalledWith(42);
    expect(mediaLog.mediaSessionAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'seekto', seekTime: 42 }));
  });

  it('removes its handlers and metadata when unbound', () => {
    const ms = fakeMediaSession();
    const c = controller();
    const unbind = bindMediaSession(c, { mediaSession: ms, MediaMetadataCtor: FakeMetadata });
    unbind();
    expect(ms.handlers.size).toBe(0);
    expect(ms.playbackState).toBe('none');
  });

  it('says so, once, when the browser has no Media Session API', () => {
    bindMediaSession(controller(), { mediaSession: undefined });
    expect(mediaLog.mediaSessionUnavailable).toHaveBeenCalledWith({ reason: 'no-media-session-api' });
  });

  it('never names a raw content id as the title', () => {
    expect(mediaSessionMetadata({ currentItem: { contentId: 'plex:9', title: 'plex:9' }, queue: { items: [], currentIndex: -1 } }).title).toBe('Playing');
  });
});
