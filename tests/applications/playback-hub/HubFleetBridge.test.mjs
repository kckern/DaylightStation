import { describe, it, expect, beforeEach } from 'vitest';
import {
  HubFleetBridge,
  HUB_STATUS_TOPIC,
  mapLaneToSnapshot,
} from '../../../backend/src/3_applications/playback-hub/runtime/HubFleetBridge.mjs';
import { SlotStatus } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs';
import {
  validateDeviceStateBroadcast,
} from '../../../shared/contracts/media/envelopes.mjs';
import {
  validateSessionSnapshot,
} from '../../../shared/contracts/media/shapes.mjs';

/**
 * In-memory event bus: subscribe/broadcast recording. Mirrors the
 * WebSocketEventBus surface the bridge relies on.
 */
class FakeEventBus {
  subscriptions = new Map(); // topic -> handler[]
  broadcasts = [];           // { topic, payload }

  subscribe(topic, handler) {
    if (!this.subscriptions.has(topic)) this.subscriptions.set(topic, []);
    this.subscriptions.get(topic).push(handler);
    return () => {
      const arr = this.subscriptions.get(topic) || [];
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  broadcast(topic, payload) {
    this.broadcasts.push({ topic, payload });
  }

  /** Simulate the HubStatusBroadcaster publishing a status snapshot. */
  emitStatus(devices, fetchedAt = new Date()) {
    const handlers = this.subscriptions.get(HUB_STATUS_TOPIC) || [];
    for (const h of handlers) {
      h({ type: 'playback-hub.status.snapshot', data: { devices, fetchedAt } }, HUB_STATUS_TOPIC);
    }
  }
}

class FakeClock {
  t = 0;
  now() { return this.t; }
  advance(ms) { this.t += ms; }
}

class RecordingLogger {
  records = [];
  debug(event, data) { this.records.push({ level: 'debug', event, data }); }
  info(event, data)  { this.records.push({ level: 'info',  event, data }); }
  warn(event, data)  { this.records.push({ level: 'warn',  event, data }); }
  error(event, data) { this.records.push({ level: 'error', event, data }); }
}

const playingLane = (color = 'red', extra = {}) => SlotStatus.fromHubJson({
  slot: 1,
  color,
  bt_connected: true,
  paused: false,
  now_playing: { queue: { source: 'plex', id: '675465' }, title: 'Clair de Lune' },
  volume: 42,
  playlist_pos: 3,
  playlist_count: 20,
  armed_source: null,
  ...extra,
});

const pausedLane = (color = 'yellow') => SlotStatus.fromHubJson({
  slot: 2,
  color,
  bt_connected: true,
  paused: true,
  now_playing: { queue: { source: 'plex', id: '622829' }, title: 'Lullaby' },
  volume: 30,
  playlist_pos: 0,
  playlist_count: 12,
  armed_source: null,
});

const idleLane = (color = 'white') => SlotStatus.fromHubJson({
  slot: 5,
  color,
  bt_connected: false,
  paused: false,
  now_playing: null,
  volume: null,
  playlist_pos: null,
  playlist_count: null,
  armed_source: null,
});

describe('mapLaneToSnapshot', () => {
  const nowIso = '2026-07-14T12:00:00.000Z';

  it('maps a playing lane to a valid playing SessionSnapshot', () => {
    const { deviceId, snapshot } = mapLaneToSnapshot(playingLane('red'), nowIso);
    expect(deviceId).toBe('speaker-red');
    expect(snapshot.sessionId).toBe('playback-hub-red');
    expect(snapshot.state).toBe('playing');
    expect(snapshot.currentItem).toMatchObject({
      contentId: 'plex:675465',
      format: 'audio',
      title: 'Clair de Lune',
    });
    expect(snapshot.position).toBe(0);
    expect(snapshot.queue.currentIndex).toBe(3);
    expect(snapshot.config.volume).toBe(42);
    expect(snapshot.meta).toEqual({ ownerId: 'speaker-red', updatedAt: nowIso });
    expect(validateSessionSnapshot(snapshot)).toEqual({ valid: true, errors: [] });
  });

  it('maps paused and idle lanes', () => {
    const paused = mapLaneToSnapshot(pausedLane('yellow'), nowIso);
    expect(paused.snapshot.state).toBe('paused');
    expect(validateSessionSnapshot(paused.snapshot).valid).toBe(true);

    const idle = mapLaneToSnapshot(idleLane('white'), nowIso);
    expect(idle.deviceId).toBe('speaker-white');
    expect(idle.snapshot.state).toBe('idle');
    expect(idle.snapshot.currentItem).toBeNull();
    // null volume defaults to 50 to satisfy the contract
    expect(idle.snapshot.config.volume).toBe(50);
    expect(validateSessionSnapshot(idle.snapshot).valid).toBe(true);
  });

  it('returns null for malformed lane entries', () => {
    expect(mapLaneToSnapshot(null, nowIso)).toBeNull();
    expect(mapLaneToSnapshot('red', nowIso)).toBeNull();
    expect(mapLaneToSnapshot({}, nowIso)).toBeNull();
    expect(mapLaneToSnapshot({ color: 42 }, nowIso)).toBeNull();
    expect(mapLaneToSnapshot({ color: '' }, nowIso)).toBeNull();
  });

  it('falls back to a lane-scoped contentId when queue ref is missing', () => {
    const { snapshot } = mapLaneToSnapshot(
      { color: 'green', paused: false, now_playing: { title: 'Mystery Track' } },
      nowIso,
    );
    expect(snapshot.state).toBe('playing');
    expect(snapshot.currentItem.contentId).toBe('playback-hub:green');
    expect(validateSessionSnapshot(snapshot).valid).toBe(true);
  });

  it('clamps out-of-range volume into 0..100', () => {
    const loud = mapLaneToSnapshot(playingLane('red', { volume: 130 }), nowIso);
    expect(loud.snapshot.config.volume).toBe(100);
    const negative = mapLaneToSnapshot(playingLane('red', { volume: -5 }), nowIso);
    expect(negative.snapshot.config.volume).toBe(0);
  });
});

describe('HubFleetBridge', () => {
  let bus, clock, logger, bridge;

  beforeEach(() => {
    bus = new FakeEventBus();
    clock = new FakeClock();
    logger = new RecordingLogger();
    bridge = new HubFleetBridge({ eventBus: bus, logger, clock, heartbeatMs: 10000 });
  });

  it('requires an eventBus with subscribe()', () => {
    expect(() => new HubFleetBridge()).toThrow(/eventBus/);
    expect(() => new HubFleetBridge({ eventBus: {} })).toThrow(/subscribe/);
  });

  it('broadcasts a valid device-state envelope per lane on first snapshot', () => {
    bridge.start();
    bus.emitStatus([playingLane('red'), idleLane('white')]);

    expect(bus.broadcasts).toHaveLength(2);
    const [red, white] = bus.broadcasts;

    expect(red.topic).toBe('device-state:speaker-red');
    expect(red.payload.deviceId).toBe('speaker-red');
    expect(red.payload.reason).toBe('initial');
    expect(red.payload.snapshot.state).toBe('playing');
    expect(validateDeviceStateBroadcast(red.payload)).toEqual({ valid: true, errors: [] });

    expect(white.topic).toBe('device-state:speaker-white');
    expect(white.payload.snapshot.state).toBe('idle');
    expect(validateDeviceStateBroadcast(white.payload)).toEqual({ valid: true, errors: [] });
  });

  it('publishes only on change: identical ticks are suppressed', () => {
    bridge.start();
    bus.emitStatus([playingLane('red')]);
    clock.advance(3000);
    bus.emitStatus([playingLane('red')]);
    clock.advance(3000);
    bus.emitStatus([playingLane('red')]);

    expect(bus.broadcasts).toHaveLength(1);
    expect(bus.broadcasts[0].payload.reason).toBe('initial');
  });

  it('publishes reason "change" when the lane state changes', () => {
    bridge.start();
    bus.emitStatus([playingLane('red')]);
    clock.advance(3000);
    bus.emitStatus([SlotStatus.fromHubJson({
      slot: 1, color: 'red', bt_connected: true, paused: true,
      now_playing: { queue: { source: 'plex', id: '675465' }, title: 'Clair de Lune' },
      volume: 42, playlist_pos: 3, playlist_count: 20, armed_source: null,
    })]);

    expect(bus.broadcasts).toHaveLength(2);
    expect(bus.broadcasts[1].payload.reason).toBe('change');
    expect(bus.broadcasts[1].payload.snapshot.state).toBe('paused');
  });

  it('emits a heartbeat every ~10s while playing (driven by 3s ticks)', () => {
    bridge.start();
    bus.emitStatus([playingLane('red')]); // t=0 initial
    for (const _ of [1, 2, 3]) {
      clock.advance(3000); // t=3000,6000,9000 — under heartbeat window
      bus.emitStatus([playingLane('red')]);
    }
    expect(bus.broadcasts).toHaveLength(1);

    clock.advance(3000); // t=12000 — >= 10s since last publish
    bus.emitStatus([playingLane('red')]);
    expect(bus.broadcasts).toHaveLength(2);
    expect(bus.broadcasts[1].payload.reason).toBe('heartbeat');

    // Next window: no beat until another 10s elapses.
    clock.advance(3000);
    bus.emitStatus([playingLane('red')]);
    expect(bus.broadcasts).toHaveLength(2);
  });

  it('heartbeats paused lanes (active session) but not idle lanes', () => {
    bridge.start();
    bus.emitStatus([pausedLane('yellow'), idleLane('white')]);
    expect(bus.broadcasts).toHaveLength(2);

    clock.advance(12000);
    bus.emitStatus([pausedLane('yellow'), idleLane('white')]);

    const later = bus.broadcasts.slice(2);
    expect(later).toHaveLength(1);
    expect(later[0].topic).toBe('device-state:speaker-yellow');
    expect(later[0].payload.reason).toBe('heartbeat');
  });

  it('tolerates malformed snapshots and lane entries without throwing', () => {
    bridge.start();
    const handlers = bus.subscriptions.get(HUB_STATUS_TOPIC);

    // Malformed top-level payloads.
    expect(() => handlers[0](null)).not.toThrow();
    expect(() => handlers[0]('garbage')).not.toThrow();
    expect(() => handlers[0]({ data: { devices: 'nope' } })).not.toThrow();
    expect(() => handlers[0]({ data: {} })).not.toThrow();
    expect(bus.broadcasts).toHaveLength(0);

    // Malformed lanes are skipped; valid lanes still flow.
    bus.emitStatus([null, 'junk', { color: 7 }, playingLane('blue')]);
    expect(bus.broadcasts).toHaveLength(1);
    expect(bus.broadcasts[0].topic).toBe('device-state:speaker-blue');
    expect(logger.records.some((r) => r.level === 'error')).toBe(false);
  });

  it('publishes nothing for an empty status and never throws on it', () => {
    bridge.start();
    expect(() => bus.emitStatus([])).not.toThrow();
    expect(bus.broadcasts).toHaveLength(0);
  });

  it('survives a broadcast() that throws', () => {
    bus.broadcast = () => { throw new Error('ws down'); };
    bridge.start();
    expect(() => bus.emitStatus([playingLane('red')])).not.toThrow();
    expect(logger.records.some(
      (r) => r.event === 'playback-hub.fleet-bridge.broadcast_error',
    )).toBe(true);
  });

  it('start() is idempotent and stop() unsubscribes + resets lane memory', () => {
    bridge.start();
    bridge.start();
    expect(bus.subscriptions.get(HUB_STATUS_TOPIC)).toHaveLength(1);

    bus.emitStatus([playingLane('red')]);
    expect(bus.broadcasts).toHaveLength(1);

    bridge.stop();
    bridge.stop(); // idempotent
    bus.emitStatus([playingLane('red')]);
    expect(bus.broadcasts).toHaveLength(1); // no new publishes after stop

    // Restart: lane memory was cleared, so first sight is 'initial' again.
    bridge.start();
    bus.emitStatus([playingLane('red')]);
    expect(bus.broadcasts).toHaveLength(2);
    expect(bus.broadcasts[1].payload.reason).toBe('initial');
  });

  it('keeps a stable per-lane sessionId across publishes', () => {
    bridge.start();
    bus.emitStatus([playingLane('red')]);
    clock.advance(12000);
    bus.emitStatus([playingLane('red')]);
    const ids = bus.broadcasts.map((b) => b.payload.snapshot.sessionId);
    expect(ids).toEqual(['playback-hub-red', 'playback-hub-red']);
  });
});
