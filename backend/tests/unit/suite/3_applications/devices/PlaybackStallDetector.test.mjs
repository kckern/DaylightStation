/**
 * PlaybackStallDetector — "the player says it is playing and the playhead has
 * not moved" tests.
 *
 * Mirrors the DeviceLivenessService test harness: a mock event bus that captures
 * the pattern subscriber and lets the test drive incoming device-state
 * broadcasts, plus a controllable clock. Time is measured with the injected
 * clock rather than real timers, because the detector measures elapsed time
 * between heartbeats rather than arming a timer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybackStallDetector } from '#apps/devices/services/PlaybackStallDetector.mjs';
import { DEVICE_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (ts) => { now = ts; },
  };
}

function makeMockBus() {
  const patternHandlers = [];
  return {
    subscribePattern: vi.fn((predicate, handler) => {
      const entry = { predicate, handler };
      patternHandlers.push(entry);
      return () => {
        const idx = patternHandlers.indexOf(entry);
        if (idx !== -1) patternHandlers.splice(idx, 1);
      };
    }),
    broadcast: vi.fn(),
    publish: vi.fn(),
    _deliver(topic, payload) {
      for (const { predicate, handler } of patternHandlers) {
        if (predicate(topic)) handler(payload, topic);
      }
    },
    _patternHandlers: patternHandlers,
  };
}

/** A lecture video: finite, positive, seekable duration. */
function makeItem(overrides = {}) {
  return {
    contentId: 'plex:694719',
    format: 'dash_video',
    title: 'The Fall of Rome, Lecture 3',
    duration: 1800,
    ...overrides,
  };
}

function makeSnapshot({ state = 'playing', position = 0, currentItem = makeItem() } = {}) {
  return {
    sessionId: 'sess-1',
    state,
    currentItem,
    position,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    meta: { ownerId: 'piano-tablet', updatedAt: new Date().toISOString() },
  };
}

describe('PlaybackStallDetector', () => {
  let clock, bus, logger, onStall, onRecover, detector;

  beforeEach(() => {
    clock = makeClock();
    bus = makeMockBus();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    onStall = vi.fn();
    onRecover = vi.fn();
    detector = new PlaybackStallDetector({
      eventBus: bus,
      logger,
      clock,
      stallThresholdMs: 60_000,
      onStall,
      onRecover,
    });
    detector.start();
  });

  /**
   * Deliver one heartbeat, optionally advancing the clock first. `tsMs` lets a
   * test forge an out-of-order payload timestamp.
   */
  function beat({ deviceId = 'piano-tablet', advanceMs = 0, tsMs = null, reason = 'heartbeat', ...snap } = {}) {
    if (advanceMs) clock.advance(advanceMs);
    bus._deliver(DEVICE_STATE_TOPIC(deviceId), {
      topic: 'device-state',
      deviceId,
      reason,
      snapshot: makeSnapshot(snap),
      ts: new Date(tsMs ?? clock.now()).toISOString(),
    });
  }

  /**
   * Anti-vacuity control. Every "does not alert" assertion below would pass for
   * free if the harness were broken — a mock bus that never delivers, or an item
   * factory that returned nothing, would produce silence for the wrong reason.
   * This drives a fresh device through the canonical stall on the SAME harness
   * and insists it alerts, so silence elsewhere is a verdict rather than a gap.
   */
  function expectHarnessStillDetectsAStall() {
    const before = onStall.mock.calls.length;
    beat({ deviceId: 'control-device', position: 0 });
    for (let i = 0; i < 13; i += 1) beat({ deviceId: 'control-device', advanceMs: 5000, position: 0 });
    expect(onStall.mock.calls.length).toBe(before + 1);
    expect(onStall.mock.calls[before][0].deviceId).toBe('control-device');
  }

  // ── The failure this whole tier exists for ──────────────────────────────

  it('classifies a playing device whose position never moves as stalled', () => {
    beat({ position: 0 });
    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 0 });

    expect(detector.isStalled('piano-tablet')).toBe(true);
    expect(onStall).toHaveBeenCalledTimes(1);
    const alert = onStall.mock.calls[0][0];
    expect(alert.deviceId).toBe('piano-tablet');
    expect(alert.stalledForMs).toBeGreaterThanOrEqual(60_000);
    expect(alert.position).toBe(0);
    expect(alert.title).toBe('The Fall of Rome, Lecture 3');
    expect(alert.contentId).toBe('plex:694719');
  });

  it('alerts once per stall episode, not once per heartbeat', () => {
    beat({ position: 0 });
    for (let i = 0; i < 60; i += 1) beat({ advanceMs: 5000, position: 0 });

    expect(onStall).toHaveBeenCalledTimes(1);
  });

  // ── Legitimate cases that must NOT alert ────────────────────────────────

  it('does not alert a paused device, whose position is frozen on purpose', () => {
    beat({ state: 'paused', position: 42 });
    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, state: 'paused', position: 42 });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert a device that is buffering a long seek', () => {
    beat({ state: 'playing', position: 100 });
    // A seek: the player drops to buffering and stays there well past the
    // threshold while the new range downloads.
    for (let i = 0; i < 20; i += 1) beat({ advanceMs: 5000, state: 'buffering', position: 900 });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert an idle device', () => {
    for (let i = 0; i < 20; i += 1) beat({ advanceMs: 5000, state: 'idle', position: 0, currentItem: null });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert a device whose position is advancing', () => {
    let pos = 0;
    beat({ position: pos });
    for (let i = 0; i < 30; i += 1) { pos += 5; beat({ advanceMs: 5000, position: pos }); }

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert on a single sample, however old the clock gets', () => {
    beat({ position: 0 });
    clock.advance(10 * 60_000);

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert before it has seen enough samples to be sure', () => {
    // Two heartbeats a long way apart is a reporting gap, not an observed stall.
    beat({ position: 0 });
    beat({ advanceMs: 120_000, position: 0 });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert on content with no finite positive duration (a live stream)', () => {
    beat({ position: 0, currentItem: makeItem({ duration: 0 }) });
    for (let i = 0; i < 20; i += 1) {
      beat({ advanceMs: 5000, position: 0, currentItem: makeItem({ duration: 0 }) });
    }

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert on content explicitly flagged live', () => {
    const live = makeItem({ isLive: true, duration: 3600 });
    beat({ position: 0, currentItem: live });
    for (let i = 0; i < 20; i += 1) beat({ advanceMs: 5000, position: 0, currentItem: live });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('does not alert when the playhead is parked at the end of the item', () => {
    const item = makeItem({ duration: 1800 });
    beat({ position: 1800, currentItem: item });
    for (let i = 0; i < 20; i += 1) beat({ advanceMs: 5000, position: 1800, currentItem: item });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('restarts the window when the content changes', () => {
    beat({ position: 0 });
    for (let i = 0; i < 10; i += 1) beat({ advanceMs: 5000, position: 0 });
    // A new lecture starts at position 0 — 50s of the previous item's frozen
    // playhead must not carry over into the new item's window.
    const next = makeItem({ contentId: 'plex:694720', title: 'Lecture 4' });
    beat({ advanceMs: 5000, position: 0, currentItem: next });
    beat({ advanceMs: 5000, position: 0, currentItem: next });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  // ── Skew and ordering ───────────────────────────────────────────────────

  it('ignores an out-of-order heartbeat rather than reading it as a fresh sample', () => {
    beat({ position: 10 });
    const atFirst = clock.now();
    clock.advance(5000);
    beat({ position: 20 });

    // A delayed duplicate of the first beat arrives after the second.
    beat({ tsMs: atFirst, position: 10 });

    const state = detector.getStallState('piano-tablet');
    expect(state.position).toBe(20);
    expect(state.samples).toBe(2);
  });

  it('restarts the window when the server clock jumps backwards', () => {
    beat({ position: 0 });
    for (let i = 0; i < 8; i += 1) beat({ advanceMs: 5000, position: 0 });
    // NTP steps the SERVER clock back an hour mid-window. The device's own
    // timestamps keep moving forward, so this is not an out-of-order beat — it
    // is a receipt time that appears to precede the one before it.
    const deviceTs = clock.now() + 5000;
    clock.advance(-3_600_000);
    beat({ tsMs: deviceTs, position: 0 });

    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
    expect(detector.getStallState('piano-tablet').samples).toBe(1);
  });

  // ── Recovery ────────────────────────────────────────────────────────────

  it('recovers when the playhead moves again, and can alert on a second episode', () => {
    beat({ position: 0 });
    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 0 });
    expect(onStall).toHaveBeenCalledTimes(1);

    beat({ advanceMs: 5000, position: 5 });
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(detector.isStalled('piano-tablet')).toBe(false);

    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 5 });
    expect(onStall).toHaveBeenCalledTimes(2);
  });

  it('recovers when the device stops playing', () => {
    beat({ position: 0 });
    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 0 });
    expect(detector.isStalled('piano-tablet')).toBe(true);

    beat({ advanceMs: 5000, state: 'paused', position: 0 });
    expect(detector.isStalled('piano-tablet')).toBe(false);
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  // ── Housekeeping ────────────────────────────────────────────────────────

  it('ignores synthesized offline broadcasts', () => {
    beat({ position: 0 });
    for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 0, reason: 'offline' });

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('tracks devices independently', () => {
    beat({ deviceId: 'piano-tablet', position: 0 });
    beat({ deviceId: 'shield-tv', position: 0 });
    for (let i = 0; i < 13; i += 1) {
      clock.advance(5000);
      beat({ deviceId: 'piano-tablet', position: 0 });
      beat({ deviceId: 'shield-tv', position: 100 + i });
    }

    expect(detector.isStalled('piano-tablet')).toBe(true);
    expect(detector.isStalled('shield-tv')).toBe(false);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('stops observing the bus on stop()', () => {
    detector.stop();
    expect(bus._patternHandlers).toHaveLength(0);
  });

  it('survives an onStall handler that throws', () => {
    onStall.mockImplementation(() => { throw new Error('notification blew up'); });
    beat({ position: 0 });
    expect(() => {
      for (let i = 0; i < 13; i += 1) beat({ advanceMs: 5000, position: 0 });
    }).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
