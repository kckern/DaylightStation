/**
 * playback-hub -> Plex session bridge.
 *
 * The hub is headless, so none of the Player-side tests cover it: these are the
 * only thing standing between "music plays to the speakers" and "it shows up on
 * the dashboard". The hub was offline when this was written, so this suite is
 * also the only verification the mapping ever got.
 *
 * The rule that matters most here: a lane going idle is STOPPED, not finished.
 * Reporting it as completed would write tracks nobody finished into Plex watch
 * history.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPlexHubSessions, stopPlexHubSessions } from './plexHubSessions.mjs';

function fakeBus() {
  const handlers = new Map();
  return {
    subscribe: vi.fn((topic, handler) => {
      handlers.set(topic, handler);
      return () => handlers.delete(topic);
    }),
    async emit(topic, data) {
      await handlers.get(topic)?.({ data });
    },
    has: (topic) => handlers.has(topic),
  };
}

function fakeReporter() {
  return {
    execute: vi.fn().mockResolvedValue({ reported: true }),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
  };
}

/** A lane as the hub publishes it. `duration` is seconds, per the contract. */
const lane = (over = {}) => ({
  color: 'red',
  paused: false,
  now_playing: {
    title: 'Great Day For Up!',
    duration: 292,
    queue: { source: 'plex', id: '675465' },
    ...(over.now_playing || {}),
  },
  ...(() => { const { now_playing, ...rest } = over; return rest; })(),
});

function build() {
  const eventBus = fakeBus();
  const reportPlaybackSession = fakeReporter();
  createPlexHubSessions({
    eventBus,
    reportPlaybackSession,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    clock: { now: () => 1_789_577_175_000 },
  });
  return { eventBus, reportPlaybackSession };
}

afterEach(() => stopPlexHubSessions());

describe('a playing lane becomes a Plex session', () => {
  it('reports the speaker under its own fleet surface id', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [lane()] });
    expect(reportPlaybackSession.execute).toHaveBeenCalledWith(expect.objectContaining({
      surfaceId: 'fleet:speaker-red',
      contentId: 'plex:675465',
    }));
  });

  it('converts the contract’s seconds into the session’s milliseconds', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [lane({ time_pos: 42.5 })] });
    expect(reportPlaybackSession.execute).toHaveBeenCalledWith(expect.objectContaining({
      positionMs: 42_500,
      durationMs: 292_000,
    }));
  });

  it('NEVER reports completion — the hub cannot tell finishing from skipping', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [lane()] });
    expect(reportPlaybackSession.execute).toHaveBeenCalledWith(expect.objectContaining({
      completed: false,
    }));
  });

  it('keeps a paused lane alive rather than letting it be reaped', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [lane({ paused: true })] });
    expect(reportPlaybackSession.execute).toHaveBeenCalled();
    expect(reportPlaybackSession.stop).not.toHaveBeenCalled();
  });

  it('keeps each speaker on its own surface', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', {
      devices: [lane(), lane({ color: 'blue' })],
    });
    const surfaces = reportPlaybackSession.execute.mock.calls.map((c) => c[0].surfaceId);
    expect(surfaces).toEqual(['fleet:speaker-red', 'fleet:speaker-blue']);
  });
});

describe('an idle lane is stopped, not completed', () => {
  it('stops the session when the music ends', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [{ color: 'red', now_playing: null }] });
    expect(reportPlaybackSession.stop).toHaveBeenCalledWith(expect.objectContaining({
      surfaceId: 'fleet:speaker-red',
    }));
    expect(reportPlaybackSession.execute).not.toHaveBeenCalled();
  });
});

describe('what it declines to report', () => {
  it('ignores a lane playing something the media server does not own', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', {
      devices: [lane({ now_playing: { queue: { source: 'radio', id: 'kexp' } } })],
    });
    expect(reportPlaybackSession.execute).not.toHaveBeenCalled();
  });

  it('ignores a lane whose queue ref is missing (the playback-hub fallback)', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', {
      devices: [lane({ now_playing: { queue: null } })],
    });
    expect(reportPlaybackSession.execute).not.toHaveBeenCalled();
  });

  it('survives a malformed lane without dropping its healthy neighbour', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: [null, 'nonsense', lane()] });
    expect(reportPlaybackSession.execute).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed status payload', async () => {
    const { eventBus, reportPlaybackSession } = build();
    await eventBus.emit('playback-hub:status', { devices: 'not-an-array' });
    expect(reportPlaybackSession.execute).not.toHaveBeenCalled();
  });
});

describe('it never breaks the hub', () => {
  it('swallows a failing media server', async () => {
    const eventBus = fakeBus();
    const reportPlaybackSession = {
      execute: vi.fn().mockRejectedValue(new Error('plex is down')),
      stop: vi.fn(),
    };
    createPlexHubSessions({
      eventBus,
      reportPlaybackSession,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    });
    await expect(eventBus.emit('playback-hub:status', { devices: [lane()] })).resolves.toBeUndefined();
  });

  it('subscribes to nothing when no media server is configured', () => {
    const eventBus = fakeBus();
    const { plexHubSessions } = createPlexHubSessions({
      eventBus,
      reportPlaybackSession: null,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(plexHubSessions).toBeNull();
    expect(eventBus.subscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes on stop', async () => {
    const { eventBus } = build();
    expect(eventBus.has('playback-hub:status')).toBe(true);
    stopPlexHubSessions();
    expect(eventBus.has('playback-hub:status')).toBe(false);
  });
});
