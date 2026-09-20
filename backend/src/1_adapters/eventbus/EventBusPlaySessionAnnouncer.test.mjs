import { describe, it, expect } from 'vitest';
import { EventBusPlaySessionAnnouncer } from './EventBusPlaySessionAnnouncer.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };

function harness({ placementFor, overlayConfigFor, sessions = null } = {}) {
  const sent = [];
  const direct = [];
  let onSubscription = null;
  const eventBus = {
    broadcast: (topic, payload) => sent.push({ topic, payload }),
    onClientSubscription: (handler) => { onSubscription = handler; },
    sendToClient: (clientId, payload) => direct.push({ clientId, payload }),
  };
  const announcer = new EventBusPlaySessionAnnouncer({
    eventBus, placementFor, overlayConfigFor, sessions,
    logger: quiet,
  });
  return {
    sent, direct, announcer,
    subscribe: (clientId, topics) => onSubscription?.(clientId, topics),
  };
}

const PLACEMENT = { zone: 'bottom', box: [0, 0.79, 1, 0.21], toast: [0.525, 0.79, 0.22, 0.11], orientation: 'wide' };

const session = (content = null) => ({
  id: 's1', deviceId: 'tv', surface: 'console', userId: 'kid',
  playedMs: 61_000, confidenceMs: 2_000, status: 'active',
  loadId: 'load-1', loadedAt: '2026-09-11T17:59:30.000Z', controllers: 2,
  startedAt: '2026-09-11T18:00:00.000Z', endedAt: null, endReason: null,
  lastState: 'playing', lastObservedAt: '2026-09-11T18:01:01.000Z', content,
});

const GB = {
  contentId: 'retroarch:gb/super-mario-land', title: 'Super Mario Land',
  console: 'gb', consoleLabel: 'Game Boy',
};

describe('EventBusPlaySessionAnnouncer', () => {
  it('publishes the system and its placement on start', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    await announcer.started(session(GB));

    expect(sent[0].topic).toBe('play-session:tv');
    expect(sent[0].payload).toMatchObject({
      event: 'play.session.started',
      system: 'gb',
      systemLabel: 'Game Boy',
      placement: PLACEMENT,
      playedMs: 61_000,
      loadId: 'load-1',
      loadedAt: '2026-09-11T17:59:30.000Z',
      startedAt: '2026-09-11T18:00:00.000Z',
      userId: 'kid',
      contentId: GB.contentId,
    });
    expect(sent[1]).toMatchObject({ topic: 'play-sessions', payload: { event: 'play.session.started' } });
  });

  // A film that reconnects mid-game must learn where it may draw straight away,
  // not at the next launch.
  it('repeats the placement on every progress tick', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    await announcer.progress(session(GB), { state: 'playing', observedAt: 'now' });

    expect(sent[0].payload.event).toBe('play.session.progress');
    expect(sent[0].payload.placement).toEqual(PLACEMENT);
    expect(sent[0].payload.system).toBe('gb');
    expect(sent[0].payload).toMatchObject({
      userId: 'kid', contentId: GB.contentId, title: GB.title,
      loadId: 'load-1', loadedAt: '2026-09-11T17:59:30.000Z',
      startedAt: '2026-09-11T18:00:00.000Z', controllers: 2,
    });
  });

  it('reports no system for a session that is not yet named', async () => {
    const { sent, announcer } = harness({ placementFor: () => null });
    await announcer.started(session(null));

    expect(sent[0].payload.system).toBeNull();
    expect(sent[0].payload.systemLabel).toBeNull();
    expect(sent[0].payload.placement).toBeNull();
  });

  it('works with no placement resolver at all', async () => {
    const { sent, announcer } = harness();
    await announcer.started(session(GB));

    expect(sent[0].payload.placement).toBeNull();
    expect(sent[0].payload.system).toBe('gb');
  });

  // Geometry is decoration; the meter is the point. A placement that throws must
  // not take the broadcast with it.
  it('still publishes when the placement lookup throws', async () => {
    const { sent, announcer } = harness({
      placementFor: () => { throw new Error('bad geometry'); },
    });
    await announcer.started(session(GB));

    expect(sent).toHaveLength(2);
    expect(sent[0].payload.placement).toBeNull();
    expect(sent[0].payload.playedMs).toBe(61_000);
  });

  it('publishes the resolved overlay config alongside placement', async () => {
    const OVERLAY = { anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: ['player', 'timer'] };
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT, overlayConfigFor: () => OVERLAY });
    await announcer.started(session(GB));

    expect(sent[0].payload.overlay).toEqual(OVERLAY);
  });

  it('reports no overlay config when no resolver is wired', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    await announcer.started(session(GB));

    expect(sent[0].payload.overlay).toBeNull();
  });

  it('still publishes when the overlay config lookup throws', async () => {
    const { sent, announcer } = harness({
      placementFor: () => PLACEMENT,
      overlayConfigFor: () => { throw new Error('bad config'); },
    });
    await announcer.started(session(GB));

    expect(sent).toHaveLength(2);
    expect(sent[0].payload.overlay).toBeNull();
    expect(sent[0].payload.playedMs).toBe(61_000);
  });

  it('keeps playedMs cumulative and never a delta', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    const s = session(GB);
    await announcer.progress(s, { state: 'playing', observedAt: 'a' });
    await announcer.progress(s, { state: 'playing', observedAt: 'b' });

    expect(sent.filter((m) => m.topic === 'play-session:tv').map((m) => m.payload.playedMs))
      .toEqual([61_000, 61_000]);
  });

  it('replays an open session to a client subscribing mid-game', async () => {
    const open = session(GB);
    const { direct, subscribe } = harness({
      sessions: {
        findOpenForDevice: async (deviceId) => deviceId === 'tv' ? open : null,
        listOpen: async () => [open],
      },
    });
    await subscribe('client-1', ['play-session:tv']);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      clientId: 'client-1',
      payload: {
        topic: 'play-session:tv', event: 'play.session.progress',
        sessionId: 's1', replay: true,
      },
    });
  });

  it('replays all open sessions to the house-wide topic', async () => {
    const tv = session(GB);
    const garage = { ...session(null), id: 's2', deviceId: 'garage-tv' };
    const { direct, subscribe } = harness({
      sessions: { listOpen: async () => [tv, garage] },
    });
    await subscribe('client-2', ['play-sessions']);
    expect(direct.map((m) => m.payload.sessionId)).toEqual(['s1', 's2']);
    expect(direct.every((m) => m.payload.topic === 'play-sessions')).toBe(true);
  });
});
