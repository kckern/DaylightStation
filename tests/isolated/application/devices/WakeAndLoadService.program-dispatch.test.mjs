// Regression (2026-10-02/03, office-tv "Office Morning Program"):
//   1. prewarm was unbounded — a Plex queue that serialized behind test runs
//      held the load for 12 minutes before the screen was even told to play.
//   2. a queue=<program> dispatch armed the playback watchdog with the program
//      id ("office-program"), which no screen ever reports, so every morning
//      program — including the 10-02 one that played the news for minutes —
//      was reported as "The screen did not confirm playback".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const DEVICE = 'office-tv';
const DISPATCH = 'program-dispatch-1';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice(overrides = {}) {
  return {
    id: DEVICE,
    screenPath: '/screen/office',
    defaultVolume: null,
    hasCapability: () => false,
    powerOn: async () => ({ ok: true, verified: true, elapsedMs: 5 }),
    setVolume: async () => ({ ok: true }),
    prepareForContent: async () => ({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeEventBus({ subscribers = 1 } = {}) {
  const handlers = new Map();
  return {
    publish(topic, payload) { (handlers.get(topic) || []).forEach((h) => h(payload)); },
    subscribe(topic, handler) {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(handler);
      return () => {
        const list = handlers.get(topic);
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    getTopicSubscriberCount: () => subscribers,
    waitForMessage: vi.fn().mockResolvedValue({
      topic: 'device-ack', deviceId: DEVICE, commandId: DISPATCH, ok: true,
    }),
  };
}

// The screen as it sat before the morning dispatch: an idle owner at rev 4.
const baseline = {
  sessionId: 'office-session', state: 'idle',
  currentItem: null,
  queue: { items: [], currentIndex: -1, upNextCount: 0, executionOrder: [] },
  meta: { ownerId: 'office-owner', playbackOwner: { ownerInstanceId: 'player-1', playbackRevision: 4, queueRevision: 4 } },
};

function playing(contentId, { revision = 5, queue = [contentId] } = {}) {
  return {
    deviceId: DEVICE, reason: 'change',
    snapshot: {
      ...baseline, state: 'playing',
      currentItem: { contentId, queueItemId: 'q0', format: 'video' },
      queue: { items: queue.map((id, i) => ({ contentId: id, queueItemId: `q${i}` })), currentIndex: 0, upNextCount: queue.length - 1, executionOrder: [] },
      meta: { ...baseline.meta, playbackOwner: { ownerInstanceId: 'player-1', playbackRevision: revision, queueRevision: revision } },
    },
  };
}

const confirmed = (broadcast) => broadcast.mock.calls.some(([e]) => e.step === 'playback' && e.status === 'confirmed');
const progress = (broadcast, step, status) => broadcast.mock.calls.map(([e]) => e).find((e) => e.step === step && e.status === status);

describe('WakeAndLoadService — program dispatch (prewarm deadline + watchdog basis)', () => {
  let logger, broadcast, eventBus, device, prewarmService;

  const build = (extra = {}) => new WakeAndLoadService({
    ...testApplicationRuntime(),
    deviceService: { get: () => device },
    readinessPolicy: { isReady: async () => ({ ready: true }) },
    broadcast, eventBus, prewarmService, logger,
    deviceLivenessService: { getLastSnapshot: () => ({ snapshot: baseline }) },
    ...extra,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    logger = makeLogger();
    broadcast = vi.fn();
    eventBus = makeEventBus();
    device = makeDevice();
    prewarmService = { prewarm: vi.fn(() => new Promise(() => {})) }; // Plex saturated: never returns
  });

  afterEach(() => { vi.useRealTimers(); });

  describe('Bug 1: prewarm deadline', () => {
    it('does not let a hung prewarm block the load; proceeds unprewarmed after the default deadline', async () => {
      const svc = build();
      let result = null;
      svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH }).then((r) => { result = r; });

      await vi.advanceTimersByTimeAsync(9_000);
      expect(result).toBeNull();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(result?.ok).toBe(true);
      expect(result.steps.prewarm).toEqual(expect.objectContaining({ ok: false, reason: 'timeout' }));
      expect(logger.warn).toHaveBeenCalledWith('wake-and-load.prewarm.timeout',
        expect.objectContaining({ deviceId: DEVICE, dispatchId: DISPATCH, contentRef: 'office-program', deadlineMs: 10_000 }));
      expect(progress(broadcast, 'prewarm', 'done')).toEqual(expect.objectContaining({ warning: 'timeout' }));
      // The screen was told to play the program (WS-first queue command).
      expect(progress(broadcast, 'load', 'done')).toBeTruthy();
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
        command: 'queue', params: expect.objectContaining({ contentId: 'office-program' }),
      }));
    });

    it('honours an injected prewarm deadline', async () => {
      const svc = build({ prewarmDeadlineMs: 2_000 });
      let result = null;
      svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH }).then((r) => { result = r; });
      await vi.advanceTimersByTimeAsync(2_100);
      expect(result?.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('wake-and-load.prewarm.timeout', expect.objectContaining({ deadlineMs: 2_000 }));
    });

    it('a prewarm result that lands after the deadline cannot mutate the in-flight content query', async () => {
      let settle;
      prewarmService.prewarm = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
      eventBus = makeEventBus({ subscribers: 0 }); // URL path: loadContent receives the query object
      const svc = build();
      const run = svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });
      await vi.advanceTimersByTimeAsync(10_500);
      await run;

      const deliveredQuery = device.loadContent.mock.calls[0][1];
      settle({ status: 'ok', token: 'late-token', contentId: 'plex:late', queueContentIds: ['plex:late'] });
      await vi.advanceTimersByTimeAsync(0);

      expect(deliveredQuery).not.toHaveProperty('prewarmToken');
      expect(deliveredQuery).not.toHaveProperty('prewarmContentId');
      expect(logger.info).not.toHaveBeenCalledWith('wake-and-load.prewarm.done', expect.anything());
    });

    it('a prewarm that rejects after the deadline is swallowed (no unhandled rejection)', async () => {
      let fail;
      prewarmService.prewarm = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
      const svc = build();
      const run = svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });
      await vi.advanceTimersByTimeAsync(10_500);
      expect((await run).ok).toBe(true);
      fail(new Error('plex gave up'));
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.warn).toHaveBeenCalledWith('wake-and-load.prewarm.late', expect.objectContaining({ dispatchId: DISPATCH }));
    });
  });

  describe('Bug 2: program watchdog basis', () => {
    it('confirms a program from a concrete item of its resolved queue (10-02: news played, prewarm skipped)', async () => {
      prewarmService.prewarm = vi.fn().mockResolvedValue({
        status: 'skipped', reason: 'not plex',
        queueContentIds: ['files:news/aljazeera/20261002.mp4', 'readalong:poetry/remedy/12', 'plex:649183'],
      });
      const svc = build();
      await svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });

      eventBus.publish(`device-state:${DEVICE}`, playing('plex:somewhere-else', { queue: ['plex:somewhere-else'] }));
      expect(confirmed(broadcast)).toBe(false);

      eventBus.publish(`device-state:${DEVICE}`, playing('files:news/aljazeera/20261002.mp4'));
      expect(progress(broadcast, 'playback', 'confirmed')).toEqual(expect.objectContaining({
        contentId: 'files:news/aljazeera/20261002.mp4', dispatchId: DISPATCH,
      }));
      expect(logger.info).toHaveBeenCalledWith('wake-and-load.playback.confirmed', expect.objectContaining({
        basis: 'resolved-queue', matchedBy: 'candidate', contentId: 'files:news/aljazeera/20261002.mp4',
      }));
    });

    it('confirms a random program slot through queue overlap with the resolved queue', async () => {
      // The poetry slot is `strategy: rotation` (random per resolution): the
      // screen's own resolution picks a different poem than prewarm did.
      prewarmService.prewarm = vi.fn().mockResolvedValue({
        status: 'skipped', reason: 'not plex',
        queueContentIds: ['readalong:poetry/remedy/12', 'plex:649183', 'plex:364982'],
      });
      const svc = build();
      await svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });

      eventBus.publish(`device-state:${DEVICE}`,
        playing('readalong:poetry/remedy/60', { queue: ['readalong:poetry/remedy/60', 'plex:649183', 'plex:364982'] }));
      expect(confirmed(broadcast)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('wake-and-load.playback.confirmed',
        expect.objectContaining({ basis: 'resolved-queue', matchedBy: 'queue-overlap' }));
    });

    it('falls back to the first fresh owned playing state when the program could not be resolved in time', async () => {
      const svc = build(); // prewarm hangs
      const run = svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });
      await vi.advanceTimersByTimeAsync(10_500);
      await run;
      expect(logger.info).toHaveBeenCalledWith('wake-and-load.playback.armed',
        expect.objectContaining({ basis: 'fresh-owned-playing', dispatchId: DISPATCH }));

      // Stale: same owner revision as the pre-load snapshot — not this dispatch.
      eventBus.publish(`device-state:${DEVICE}`, playing('files:news/a.mp4', { revision: 4 }));
      expect(confirmed(broadcast)).toBe(false);
      // Not playing yet.
      const loading = playing('files:news/a.mp4');
      loading.snapshot.state = 'loading';
      eventBus.publish(`device-state:${DEVICE}`, loading);
      expect(confirmed(broadcast)).toBe(false);

      eventBus.publish(`device-state:${DEVICE}`, playing('files:news/a.mp4'));
      expect(confirmed(broadcast)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('wake-and-load.playback.confirmed',
        expect.objectContaining({ basis: 'fresh-owned-playing', contentId: 'files:news/a.mp4' }));
    });

    it('still reports a timeout when an unresolved program never plays (10-03: screen queue fetch timed out)', async () => {
      const svc = build();
      const run = svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });
      await vi.advanceTimersByTimeAsync(10_500);
      await run;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(logger.warn).toHaveBeenCalledWith('wake-and-load.playback.timeout',
        expect.objectContaining({ dispatchId: DISPATCH, basis: 'fresh-owned-playing' }));
      expect(confirmed(broadcast)).toBe(false);
    });

    it('fallback still requires the dispatch ack', async () => {
      eventBus.waitForMessage = vi.fn().mockResolvedValue(null); // no ack on WS-first, none on URL
      const svc = build();
      const run = svc.execute(DEVICE, { queue: 'office-program' }, { dispatchId: DISPATCH });
      await vi.advanceTimersByTimeAsync(10_500);
      await run;
      eventBus.publish(`device-state:${DEVICE}`, playing('files:news/a.mp4'));
      expect(confirmed(broadcast)).toBe(false);
    });
  });
});
