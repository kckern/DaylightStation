import { describe, it, expect } from 'vitest';
import { EventBusPlaySessionAnnouncer } from './EventBusPlaySessionAnnouncer.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };

function harness({ placementFor } = {}) {
  const sent = [];
  const announcer = new EventBusPlaySessionAnnouncer({
    eventBus: { broadcast: (topic, payload) => sent.push({ topic, payload }) },
    placementFor,
    logger: quiet,
  });
  return { sent, announcer };
}

const PLACEMENT = { zone: 'bottom', box: [0, 0.79, 1, 0.21], toast: [0.525, 0.79, 0.22, 0.11], orientation: 'wide' };

const session = (content = null) => ({
  id: 's1', deviceId: 'tv', surface: 'console', userId: 'kid',
  playedMs: 61_000, confidenceMs: 2_000, status: 'active',
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
    });
  });

  // A film that reconnects mid-game must learn where it may draw straight away,
  // not at the next launch.
  it('repeats the placement on every progress tick', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    await announcer.progress(session(GB), { state: 'playing', observedAt: 'now' });

    expect(sent[0].payload.event).toBe('play.session.progress');
    expect(sent[0].payload.placement).toEqual(PLACEMENT);
    expect(sent[0].payload.system).toBe('gb');
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

    expect(sent).toHaveLength(1);
    expect(sent[0].payload.placement).toBeNull();
    expect(sent[0].payload.playedMs).toBe(61_000);
  });

  it('keeps playedMs cumulative and never a delta', async () => {
    const { sent, announcer } = harness({ placementFor: () => PLACEMENT });
    const s = session(GB);
    await announcer.progress(s, { state: 'playing', observedAt: 'a' });
    await announcer.progress(s, { state: 'playing', observedAt: 'b' });

    expect(sent.map((m) => m.payload.playedMs)).toEqual([61_000, 61_000]);
  });
});
