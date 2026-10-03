// RQ-PLAY-10: a screen in Add only acks a dispatched play-now with
// appliedAs:'add'. The dispatch result must say so, and the receiver-outcome
// watchdog must look for a queue append — not for the item becoming current
// (which never happens and used to end in a false 90s playback timeout).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const owner = (queueRevision) => ({ ownerInstanceId: 'player-1', playbackRevision: 3, queueRevision });
const snapshot = (items, queueRevision) => ({
  sessionId: 's1', state: 'playing',
  currentItem: { contentId: 'plex:current', queueItemId: 'q0', format: 'video' },
  queue: { items, currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'tv', updatedAt: 'x', playbackOwner: { ...owner(queueRevision), contentId: 'plex:current', queueItemId: 'q0' } },
});

describe('WakeAndLoadService — Add only receivers', () => {
  let svc, broadcast, handlers, ackAppliedAs;
  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    handlers = new Map();
    ackAppliedAs = 'add';
    const eventBus = {
      subscribe: vi.fn((topic, cb) => { handlers.set(topic, cb); return () => handlers.delete(topic); }),
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      waitForMessage: vi.fn(async (predicate) => {
        const ack = { topic: 'device-ack', deviceId: 'tv', ok: true, appliedAs: ackAppliedAs, requestedOp: 'play-now' };
        // Correlate to whatever dispatchId the service minted.
        const [[envelope]] = broadcast.mock.calls.filter(([m]) => m.type === 'command');
        return predicate({ ...ack, commandId: envelope.commandId }) ? { ...ack, commandId: envelope.commandId } : null;
      }),
    };
    const device = {
      id: 'tv', screenPath: '/screen/tv', defaultVolume: null,
      hasCapability: vi.fn().mockReturnValue(false),
      powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true }),
      prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
      loadContent: vi.fn().mockResolvedValue({ ok: true }),
    };
    svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast, eventBus,
      commandHandlerLivenessService: { isFresh: () => true },
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: snapshot([{ contentId: 'plex:current', queueItemId: 'q0' }], 4) }) },
      logger: logger(),
    });
  });
  afterEach(() => vi.useRealTimers());

  it('reports appliedAs add and confirms the append, not playback', async () => {
    const result = await svc.execute('tv', { play: 'plex:new' });
    expect(result).toMatchObject({ ok: true, appliedAs: 'add' });
    expect(result.steps.load).toMatchObject({ method: 'websocket', appliedAs: 'add' });
    handlers.get('device-state:tv')({
      deviceId: 'tv',
      snapshot: snapshot([{ contentId: 'plex:current', queueItemId: 'q0' }, { contentId: 'plex:new', queueItemId: 'q1' }], 5),
    });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'queue', status: 'confirmed', operation: 'add' }));
    expect(broadcast.mock.calls.some(([e]) => e.step === 'playback')).toBe(false);
  });

  it('keeps the playback watchdog when the screen played it normally', async () => {
    ackAppliedAs = undefined;
    const result = await svc.execute('tv', { play: 'plex:new' });
    expect(result).not.toHaveProperty('appliedAs');
    vi.advanceTimersByTime(90_001);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'playback', status: 'timeout' }));
  });
});

describe('WakeAndLoadService — dispatch origin (B5)', () => {
  const setup = () => {
    const broadcast = vi.fn();
    const eventBus = {
      subscribe: vi.fn(() => () => {}),
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      waitForMessage: vi.fn(async () => {
        const [[envelope]] = broadcast.mock.calls.filter(([m]) => m.type === 'command');
        return { topic: 'device-ack', deviceId: 'tv', ok: true, commandId: envelope.commandId };
      }),
    };
    const device = {
      id: 'tv', screenPath: '/screen/tv', defaultVolume: null, hasCapability: () => false,
      powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true }),
      prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
      loadContent: vi.fn().mockResolvedValue({ ok: true }),
    };
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(), deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast, eventBus, commandHandlerLivenessService: { isFresh: () => true },
      deviceLivenessService: { getLastSnapshot: () => null }, logger: logger(),
    });
    const sent = () => broadcast.mock.calls.map(([m]) => m).find((m) => m.type === 'command');
    return { svc, sent };
  };

  it('stamps an automation routine origin on a dispatch nobody named (HA, schedules, triggers)', async () => {
    const { svc, sent } = setup();
    await svc.execute('tv', { play: 'plex:1' });
    expect(sent().origin).toEqual({ kind: 'routine', name: 'Automation' });
  });

  it('carries the caller origin when one is given (a person on the Media app)', async () => {
    const { svc, sent } = setup();
    const origin = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
    await svc.execute('tv', { play: 'plex:1' }, { origin });
    expect(sent().origin).toEqual(origin);
  });
});
