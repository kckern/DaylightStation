// backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ScreenContentTracker', () => {
  it('reports not-playing for an unknown device', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('reports playing after a playing:true presence message', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: true });
    expect(tracker.isPlaying('livingroom-tv')).toBe(true);
  });

  it('reports not-playing when the latest message has playing:false (art/screensaver)', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: false });
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('treats a stale heartbeat (older than TTL) as not-playing', () => {
    const clock = fakeClock();
    const tracker = new ScreenContentTracker({ clock, ttlMs: 15000 });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', playing: true });
    clock.advance(15001);
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('ignores non-presence messages and messages without deviceId', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'other', deviceId: 'x', playing: true });
    tracker.record({ type: 'screen.presence', playing: true });
    expect(tracker.isPlaying('x')).toBe(false);
  });

  it('start() subscribes to eventBus.onClientMessage', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    let handler = null;
    const eventBus = { onClientMessage: (fn) => { handler = fn; } };
    tracker.start(eventBus);
    handler('client-1', { type: 'screen.presence', deviceId: 'd', playing: true });
    expect(tracker.isPlaying('d')).toBe(true);
  });
});
