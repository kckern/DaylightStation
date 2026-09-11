// backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/**
 * The tracker takes its feed from a PRESENCE GATEWAY, not from a raw event bus.
 *
 * That is the whole shape of this class now: the gateway owns which messages
 * are `screen.presence` at all, and the tracker only decides what a presence
 * means. An earlier version subscribed to `eventBus.onClientMessage` and
 * filtered on `type` itself; this suite tested that version long after it was
 * gone, so every case here failed on the constructor guard.
 */
function fakeGateway() {
  const gateway = {
    handler: null,
    subscribeScreenPresence(fn) { gateway.handler = fn; },
  };
  return gateway;
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const build = (over = {}) => new ScreenContentTracker({
  presenceGateway: fakeGateway(), clock: fakeClock(), logger: silent, ...over,
});

describe('ScreenContentTracker', () => {
  it('requires a presence gateway — a tracker with no feed would report silence as calm', () => {
    expect(() => new ScreenContentTracker({ clock: fakeClock(), logger: silent }))
      .toThrow(/requires presenceGateway/);
  });

  it('reports not-playing for an unknown device', () => {
    expect(build().isPlaying('livingroom-tv')).toBe(false);
  });

  it('reports playing after a playing:true presence message', () => {
    const tracker = build();
    tracker.record({ deviceId: 'livingroom-tv', active: true, playing: true });
    expect(tracker.isPlaying('livingroom-tv')).toBe(true);
  });

  it('reports not-playing when the latest message has playing:false (art/screensaver)', () => {
    const tracker = build();
    tracker.record({ deviceId: 'livingroom-tv', active: true, playing: false });
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('treats a stale heartbeat (older than TTL) as not-playing', () => {
    const clock = fakeClock();
    const tracker = build({ clock, ttlMs: 15000 });
    tracker.record({ deviceId: 'livingroom-tv', playing: true });
    clock.advance(15001);
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('holds a heartbeat that is exactly at the TTL — the edge belongs to the live side', () => {
    const clock = fakeClock();
    const tracker = build({ clock, ttlMs: 15000 });
    tracker.record({ deviceId: 'livingroom-tv', playing: true });
    clock.advance(15000);
    expect(tracker.isPlaying('livingroom-tv')).toBe(true);
  });

  it('ignores a message with no deviceId — there is nothing to file it under', () => {
    const tracker = build();
    tracker.record({ playing: true });
    tracker.record(null);
    expect(tracker.isPlaying(undefined)).toBe(false);
  });

  it('start() subscribes to the gateway, and what arrives there is what it tracks', () => {
    const presenceGateway = fakeGateway();
    const tracker = new ScreenContentTracker({ presenceGateway, clock: fakeClock(), logger: silent });
    tracker.start();
    presenceGateway.handler({ deviceId: 'd', playing: true });
    expect(tracker.isPlaying('d')).toBe(true);
  });
});
