import { describe, it, expect, vi } from 'vitest';
import { MidiPresenceTracker } from '#apps/donow/presence/MidiPresenceTracker.mjs';
import { FitnessPresenceTracker } from '#apps/donow/presence/FitnessPresenceTracker.mjs';
import { PlaybackPresenceTracker } from '#apps/donow/presence/PlaybackPresenceTracker.mjs';

const START_MS = Date.parse('2026-07-30T10:00:00.000Z');

/** Fake clock: `clock()` returns a Date; `advance(ms)` moves it forward. */
const fakeClock = (startMs = START_MS) => {
  let now = startMs;
  const clock = () => new Date(now);
  clock.advance = (ms) => { now += ms; };
  return clock;
};

/** Fake bus: captures subscribers per topic, `emit(topic, payload)` fans out. */
const fakeBus = () => {
  const subscribers = new Map(); // topic -> Set<handler>
  return {
    subscribe: vi.fn((topic, handler) => {
      if (!subscribers.has(topic)) subscribers.set(topic, new Set());
      subscribers.get(topic).add(handler);
      return () => subscribers.get(topic)?.delete(handler);
    }),
    emit(topic, payload) {
      for (const handler of subscribers.get(topic) || []) handler(payload);
    },
    subscriberCount(topic) {
      return subscribers.get(topic)?.size ?? 0;
    },
  };
};

describe('MidiPresenceTracker', () => {
  it('subscribes to the "midi" topic on construction', () => {
    const bus = fakeBus();
    new MidiPresenceTracker({ eventBus: bus, clock: fakeClock() });
    expect(bus.subscribe).toHaveBeenCalledWith('midi', expect.any(Function));
  });

  it('no activity yet -> idle (silence is idle, not unknown)', () => {
    const bus = fakeBus();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock: fakeClock() });
    expect(tracker.occupancy()).toEqual({ state: 'idle', occupantId: null });
  });

  it('session_start -> active immediately', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    bus.emit('midi', { event: 'session_start' });
    expect(tracker.occupancy()).toEqual({ state: 'active', occupantId: null });
  });

  it('note_on refreshes lastSeen and keeps it active', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    bus.emit('midi', { event: 'note_on' });
    clock.advance(4 * 60_000);
    expect(tracker.occupancy()).toEqual({ state: 'active', occupantId: null });
  });

  it('silence beyond the 5 minute TTL -> idle', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    bus.emit('midi', { event: 'note_on' });
    clock.advance(5 * 60_000 + 1);
    expect(tracker.occupancy()).toEqual({ state: 'idle', occupantId: null });
  });

  it('BLE-flap case: session_start with a missed session_end self-heals to idle after the TTL', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    bus.emit('midi', { event: 'session_start' });
    expect(tracker.occupancy().state).toBe('active');
    clock.advance(6 * 60_000); // no session_end ever arrives
    expect(tracker.occupancy()).toEqual({ state: 'idle', occupantId: null });
  });

  it('session_end also refreshes lastSeen (any midi activity counts)', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    bus.emit('midi', { event: 'session_end' });
    expect(tracker.occupancy()).toEqual({ state: 'active', occupantId: null });
    clock.advance(4 * 60_000);
    expect(tracker.occupancy()).toEqual({ state: 'active', occupantId: null });
  });

  it('respects a custom ttlMs', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock, ttlMs: 60_000 });
    bus.emit('midi', { event: 'note_on' });
    clock.advance(61_000);
    expect(tracker.occupancy().state).toBe('idle');
  });

  it('stop() unsubscribes — further midi events no longer refresh presence', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new MidiPresenceTracker({ eventBus: bus, clock });
    tracker.stop();
    bus.emit('midi', { event: 'session_start' });
    expect(tracker.occupancy()).toEqual({ state: 'idle', occupantId: null });
    expect(bus.subscriberCount('midi')).toBe(0);
  });
});

describe('FitnessPresenceTracker', () => {
  it('no activity yet -> unknown (silence fails closed here, unlike midi)', () => {
    const tracker = new FitnessPresenceTracker({ clock: fakeClock() });
    expect(tracker.occupancy()).toEqual({ state: 'unknown', occupantId: null });
  });

  it('sessionActive:true within freshMs -> active, occupantId null (roster is not identity)', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock });
    tracker.observe({ event: 'fitness-profile', data: { sessionActive: true, rosterSize: 2 } });
    expect(tracker.occupancy()).toEqual({ state: 'active', occupantId: null });
  });

  it('sessionActive:false within freshMs -> idle', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock });
    tracker.observe({ event: 'fitness-profile', data: { sessionActive: false, rosterSize: 0 } });
    expect(tracker.occupancy()).toEqual({ state: 'idle', occupantId: null });
  });

  it('silence beyond the 3 minute freshMs -> unknown, even after a prior active reading', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock });
    tracker.observe({ event: 'fitness-profile', data: { sessionActive: true } });
    expect(tracker.occupancy().state).toBe('active');
    clock.advance(3 * 60_000 + 1);
    expect(tracker.occupancy()).toEqual({ state: 'unknown', occupantId: null });
  });

  it('a deviceCount>0 flap alone (no sessionActive field) does not move state — only sessionActive drives it', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock });
    tracker.observe({ event: 'fitness-profile', data: { deviceCount: 1 } });
    expect(tracker.occupancy()).toEqual({ state: 'unknown', occupantId: null });
  });

  it('ignores non "fitness-profile" log events', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock });
    tracker.observe({ event: 'some-other-event', data: { sessionActive: true } });
    expect(tracker.occupancy()).toEqual({ state: 'unknown', occupantId: null });
  });

  it('ignores a null/undefined logEvent without throwing', () => {
    const tracker = new FitnessPresenceTracker({ clock: fakeClock() });
    expect(() => tracker.observe(null)).not.toThrow();
    expect(() => tracker.observe(undefined)).not.toThrow();
  });

  it('respects a custom freshMs', () => {
    const clock = fakeClock();
    const tracker = new FitnessPresenceTracker({ clock, freshMs: 30_000 });
    tracker.observe({ event: 'fitness-profile', data: { sessionActive: true } });
    clock.advance(30_001);
    expect(tracker.occupancy().state).toBe('unknown');
  });

  it('stop() is a harmless no-op (there is nothing to unsubscribe)', () => {
    const tracker = new FitnessPresenceTracker({ clock: fakeClock() });
    expect(() => tracker.stop()).not.toThrow();
  });
});

describe('PlaybackPresenceTracker', () => {
  it('subscribes to the "playback.log" topic on construction', () => {
    const bus = fakeBus();
    new PlaybackPresenceTracker({ eventBus: bus, clock: fakeClock() });
    expect(bus.subscribe).toHaveBeenCalledWith('playback.log', expect.any(Function));
  });

  it('no playback.log event yet -> playingRecently() false', () => {
    const bus = fakeBus();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock: fakeClock() });
    expect(tracker.playingRecently()).toBe(false);
  });

  it('a playback.log event -> playingRecently() true within freshMs', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock });
    bus.emit('playback.log', { contentId: 'plex:1', percent: 42, timestamp: Date.now() });
    expect(tracker.playingRecently()).toBe(true);
  });

  it('silence beyond the 2 minute freshMs -> playingRecently() false', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock });
    bus.emit('playback.log', { contentId: 'plex:1' });
    clock.advance(2 * 60_000 + 1);
    expect(tracker.playingRecently()).toBe(false);
  });

  it('respects a custom freshMs', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock, freshMs: 15_000 });
    bus.emit('playback.log', { contentId: 'plex:1' });
    clock.advance(15_001);
    expect(tracker.playingRecently()).toBe(false);
  });

  it('does not expose occupancy() — the livingroom adapter (Task 8) combines this with TV power', () => {
    const bus = fakeBus();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock: fakeClock() });
    expect(tracker.occupancy).toBeUndefined();
  });

  it('stop() unsubscribes — further playback.log events no longer refresh presence', () => {
    const bus = fakeBus();
    const clock = fakeClock();
    const tracker = new PlaybackPresenceTracker({ eventBus: bus, clock });
    tracker.stop();
    bus.emit('playback.log', { contentId: 'plex:1' });
    expect(tracker.playingRecently()).toBe(false);
    expect(bus.subscriberCount('playback.log')).toBe(0);
  });
});
