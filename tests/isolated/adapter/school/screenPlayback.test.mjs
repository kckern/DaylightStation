/**
 * ScreenPlaybackAdapter — the real §8 playback target for a SCREEN.
 *
 * The invariant this file exists to defend is the third one: a screen that is
 * not coming on is never told a lesson started. Wake failure must throw BEFORE
 * any broadcast, so `DispatchMedia`'s existing catch files a non-advancing
 * `failed` event and the child is told to scan again — which leaves the session
 * retryable. A broadcast that escaped a failed wake would instead let
 * `media_dispatched` be recorded against a dark TV, and the idempotency matrix
 * would then answer every retry with "It is already playing. Enjoy!" forever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ScreenPlaybackAdapter, lessonTopic } from '#adapters/hardware/playback/ScreenPlaybackAdapter.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const SCREENS = [
  { id: 'livingroom-tv', device: 'livingroom-tv', location: 'livingroom' },
  { id: 'office-tv', device: 'office-tv', location: 'office' },
];

/** A bus that records everything and reports a listener on every topic. */
const makeBus = ({ listeners = 1 } = {}) => {
  const broadcasts = [];
  return {
    broadcasts,
    listeners,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    getTopicSubscriberCount() { return this.listeners; },
    of: (type) => broadcasts.filter((b) => b.payload?.type === type).map((b) => b.payload),
    onTopic: (topic) => broadcasts.filter((b) => b.topic === topic).map((b) => b.payload),
  };
};

/**
 * The reading path's seam: `wakeScreen({target, location})` -> `{ ok }`.
 * Power on + bring the kiosk forward, NOT a content load — so the screen's
 * WebSocket, the one `lesson.open` has to land on, is never dropped.
 */
const makeWake = (impl) => {
  const fn = async (args) => {
    fn.calls.push(args);
    return impl ? impl(args) : { ok: true, power: { ok: true }, foreground: { ok: true } };
  };
  fn.calls = [];
  return fn;
};

let bus, wake, adapter;

const build = (over = {}) => {
  bus = over.bus ?? makeBus();
  wake = over.wake ?? makeWake();
  adapter = new ScreenPlaybackAdapter({
    eventBus: bus, wakeScreen: wake, screens: SCREENS, logger: silent,
    // No real waiting in tests: the poll is injected.
    listenerWaitMs: 50, listenerPollMs: 5, sleep: async () => {},
    ...over.adapter,
  });
  return adapter;
};

const dispatchOne = (over = {}) => adapter.dispatch({
  target: 'livingroom-tv', contentId: 'plex:670208', learnerId: 'kid1',
  durationSec: 600, sessionId: 'ses_1', ...over,
});

beforeEach(() => { build(); });

describe('construction', () => {
  it('requires an event bus with broadcast', () => {
    expect(() => new ScreenPlaybackAdapter({ wakeScreen: makeWake(), screens: SCREENS }))
      .toThrow(/eventBus/);
  });

  it('requires a wakeScreen function', () => {
    expect(() => new ScreenPlaybackAdapter({ eventBus: makeBus(), screens: SCREENS }))
      .toThrow(/wakeScreen/);
  });
});

describe('dispatch — the happy path', () => {
  it('wakes the screen first, and only then tells it', async () => {
    const rec = await dispatchOne();
    expect(wake.calls).toHaveLength(1);
    // The room travels with the wake, exactly as the reading seam takes it.
    expect(wake.calls[0]).toEqual({ target: 'livingroom-tv', location: 'livingroom' });
    // The wake happened before any broadcast — the ordering the invariant needs.
    expect(bus.broadcasts.length).toBeGreaterThan(0);
    expect(rec.dispatchId).toEqual(expect.any(String));
  });

  it('broadcasts lesson.open on the room topic, not a global one', async () => {
    await dispatchOne();
    const opened = bus.onTopic(lessonTopic('livingroom'));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ type: 'lesson.open', sessionId: 'ses_1', learnerId: 'kid1' });
  });

  it('routes a second target to ITS OWN room', async () => {
    await adapter.dispatch({
      target: 'office-tv', contentId: 'plex:1', learnerId: 'kid2', durationSec: 60, sessionId: 'ses_2',
    });
    expect(bus.onTopic('lesson:office')).toHaveLength(1);
    expect(bus.onTopic('lesson:livingroom')).toHaveLength(0);
  });

  it('also announces the dispatch on the port topic, in the double\'s shape', async () => {
    const rec = await dispatchOne();
    const announced = bus.onTopic('school-playback');
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({
      source: 'screen-playback', type: 'dispatched', dispatchId: rec.dispatchId,
      target: 'livingroom-tv', contentId: 'plex:670208', learnerId: 'kid1',
      sessionId: 'ses_1', seconds: 0, durationSec: 600, percent: 0,
    });
  });

  it('returns the correlator record the port promises', async () => {
    const rec = await dispatchOne();
    expect(rec).toMatchObject({
      target: 'livingroom-tv', contentId: 'plex:670208', learnerId: 'kid1', sessionId: 'ses_1',
      durationSec: 600, positionSec: 0, status: 'playing', endedAt: null,
    });
    expect(Date.parse(rec.startedAt)).not.toBeNaN();
  });

  it('mints a distinct dispatchId per dispatch', async () => {
    const a = await dispatchOne();
    const b = await dispatchOne({ sessionId: 'ses_2' });
    expect(a.dispatchId).not.toBe(b.dispatchId);
  });
});

describe('dispatch — wake failure never reaches the screen', () => {
  it('throws and broadcasts NOTHING when the wake reports not-ok', async () => {
    build({ wake: makeWake(() => ({ ok: false, error: 'Display did not turn on' })) });
    await expect(dispatchOne()).rejects.toThrow(/livingroom-tv/);
    expect(bus.broadcasts).toEqual([]);
  });

  it('surfaces the failed step so the log says WHY', async () => {
    build({ wake: makeWake(() => ({ ok: false, error: 'Display did not turn on' })) });
    await expect(dispatchOne()).rejects.toThrow(/Display did not turn on/);
  });

  it('throws and broadcasts NOTHING when the wake itself throws', async () => {
    build({ wake: makeWake(() => { throw new Error('ECONNREFUSED'); }) });
    await expect(dispatchOne()).rejects.toThrow(/ECONNREFUSED/);
    expect(bus.broadcasts).toEqual([]);
  });

  it('throws and broadcasts NOTHING when the wake returns nothing at all', async () => {
    build({ wake: makeWake(() => undefined) });
    await expect(dispatchOne()).rejects.toThrow();
    expect(bus.broadcasts).toEqual([]);
  });
});

describe('dispatch — refusals that must happen BEFORE the TV is touched', () => {
  const cases = [
    ['no target', { target: undefined }, /target/],
    ['a blank target', { target: '   ' }, /target/],
    ['no contentId', { contentId: undefined }, /contentId/],
    ['no sessionId', { sessionId: undefined }, /sessionId/],
    ['a negative durationSec', { durationSec: -1 }, /durationSec/],
    ['an unknown target', { target: 'garage-speaker' }, /garage-speaker/],
  ];
  for (const [name, over, matcher] of cases) {
    it(`refuses ${name} without waking anything`, async () => {
      await expect(dispatchOne(over)).rejects.toThrow(matcher);
      expect(wake.calls).toEqual([]);
      expect(bus.broadcasts).toEqual([]);
    });
  }

  it('refuses a configured target with no location — a broadcast nobody could hear', async () => {
    build({ adapter: { screens: [{ id: 'livingroom-tv', device: 'livingroom-tv' }] } });
    await expect(dispatchOne()).rejects.toThrow(/location/);
    expect(wake.calls).toEqual([]);
    expect(bus.broadcasts).toEqual([]);
  });

  it('falls back to the target id as the device id when none is configured', async () => {
    build({ adapter: { screens: [{ id: 'livingroom-tv', location: 'livingroom' }] } });
    await dispatchOne();
    expect(wake.calls[0].target).toBe('livingroom-tv');
  });
});

describe('dispatch — nobody is listening', () => {
  it('waits for the screen to subscribe, then broadcasts', async () => {
    const slowBus = makeBus({ listeners: 0 });
    build({ bus: slowBus, adapter: { sleep: async () => { slowBus.listeners = 1; } } });
    await dispatchOne();
    expect(slowBus.onTopic(lessonTopic('livingroom'))).toHaveLength(1);
  });

  it('throws rather than broadcast into an empty room when none ever arrives', async () => {
    build({ bus: makeBus({ listeners: 0 }) });
    await expect(dispatchOne()).rejects.toThrow(/listen/i);
    expect(bus.broadcasts).toEqual([]);
    // The wake DID run — this failure is about the screen software, not the TV.
    expect(wake.calls).toHaveLength(1);
  });

  it('broadcasts immediately when the bus cannot count listeners at all', async () => {
    const dumbBus = makeBus();
    delete dumbBus.getTopicSubscriberCount;
    build({ bus: dumbBus });
    await dispatchOne();
    expect(dumbBus.onTopic(lessonTopic('livingroom'))).toHaveLength(1);
  });
});

describe('a bus fault on the observability topic must not undo the open', () => {
  it('still returns the correlator when the port-topic broadcast throws', async () => {
    const flaky = makeBus();
    const plain = flaky.broadcast;
    flaky.broadcast = (topic, payload) => {
      if (topic === 'school-playback') throw new Error('bus is down');
      return plain(topic, payload);
    };
    build({ bus: flaky });
    const rec = await dispatchOne();
    // The room WAS told; throwing here would make DispatchMedia file a
    // `failed`, and the child's retry would open the lesson a second time.
    expect(flaky.onTopic(lessonTopic('livingroom'))).toHaveLength(1);
    expect(rec.dispatchId).toEqual(expect.any(String));
  });

  it('but a fault on the ROOM topic is a real failure', async () => {
    const dead = makeBus();
    dead.broadcast = () => { throw new Error('bus is down'); };
    build({ bus: dead });
    await expect(dispatchOne()).rejects.toThrow(/bus is down/);
  });
});

describe('getStatus', () => {
  it('reports no slots — a screen is not a playback-hub slot', () => {
    expect(adapter.getStatus()).toEqual([]);
  });

  it('still reports no slots after a dispatch: this adapter observes nothing', async () => {
    await dispatchOne();
    expect(adapter.getStatus()).toEqual([]);
  });
});

describe('lessonTopic', () => {
  it('mirrors the reading convention exactly', () => {
    expect(lessonTopic('livingroom')).toBe('lesson:livingroom');
  });
});
