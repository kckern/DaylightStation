/**
 * PlaybackSessionRegistry tests.
 *
 * The lifecycle is DERIVED from a stream of progress pings — there is no
 * "started" or "stopped" signal from the surfaces — so these tests pin the two
 * derivations that are wrong in ways nobody would notice locally:
 *
 *   - switching content must SUPERSEDE, or a child changing stories leaves the
 *     first session open and the dashboard shows two things on one screen;
 *   - a surface that crashes never sends a stop, so without reaping it appears
 *     to play forever.
 */

import { describe, it, expect } from 'vitest';
import { PlaybackSessionRegistry } from './PlaybackSessionRegistry.mjs';

const T0 = 1_789_577_175_000;
const ping = (over = {}) => ({
  surfaceId: 'livingroom-tv',
  contentId: 'plex:674737',
  positionMs: 1_000,
  durationMs: 292_733,
  at: T0,
  ...over,
});

describe('PlaybackSessionRegistry.record', () => {
  it('opens a session on the first ping', () => {
    const r = new PlaybackSessionRegistry();
    const { session, opened, superseded } = r.record(ping());
    expect(opened).toBe(true);
    expect(superseded).toBeNull();
    expect(session.state).toBe('playing');
    expect(r.size).toBe(1);
  });

  it('advances the same session on later pings rather than opening another', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    const { session, opened } = r.record(ping({ positionMs: 15_000, at: T0 + 15_000 }));
    expect(opened).toBe(false);
    expect(session.positionMs).toBe(15_000);
    expect(r.size).toBe(1);
  });

  it('supersedes when the surface switches content, handing back the old session', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    const { session, opened, superseded } = r.record(ping({ contentId: 'plex:999', at: T0 + 20_000 }));
    expect(opened).toBe(true);
    expect(superseded).not.toBeNull();
    expect(superseded.contentId).toBe('plex:674737');
    expect(superseded.isStopped).toBe(true);
    expect(session.contentId).toBe('plex:999');
    expect(r.size).toBe(1); // still ONE session for the surface
  });

  it('keeps surfaces independent', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    r.record(ping({ surfaceId: 'garage-tv', contentId: 'plex:111' }));
    expect(r.size).toBe(2);
    expect(r.get('livingroom-tv').contentId).toBe('plex:674737');
    expect(r.get('garage-tv').contentId).toBe('plex:111');
  });
});

describe('PlaybackSessionRegistry.close', () => {
  it('stops and forgets the session', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    const closed = r.close({ surfaceId: 'livingroom-tv', at: T0 + 30_000 });
    expect(closed.isStopped).toBe(true);
    expect(r.get('livingroom-tv')).toBeNull();
    expect(r.size).toBe(0);
  });

  it('is safe to call when nothing is playing', () => {
    const r = new PlaybackSessionRegistry();
    expect(r.close({ surfaceId: 'nobody', at: T0 })).toBeNull();
  });
});

describe('PlaybackSessionRegistry.reapStale', () => {
  it('reaps a surface that stopped talking, so it does not play forever', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    const reaped = r.reapStale({ now: T0 + 61_000, ttlMs: 60_000 });
    expect(reaped).toHaveLength(1);
    expect(reaped[0].isStopped).toBe(true);
    expect(r.size).toBe(0);
  });

  it('leaves live sessions alone', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    expect(r.reapStale({ now: T0 + 10_000, ttlMs: 60_000 })).toHaveLength(0);
    expect(r.size).toBe(1);
  });

  it('lists live sessions for the keepalive timer', () => {
    const r = new PlaybackSessionRegistry();
    r.record(ping());
    r.record(ping({ surfaceId: 'garage-tv', contentId: 'plex:111' }));
    expect(r.live()).toHaveLength(2);
  });
});
