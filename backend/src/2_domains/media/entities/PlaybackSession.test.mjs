/**
 * PlaybackSession tests.
 *
 * These matter because the session is what Plex's dashboard and every
 * third-party consumer (Tautulli) actually see. Two failures are invisible in
 * development and obvious in the living room: a session that never stops shows
 * a child watching something forever, and a session that re-opens after
 * stopping falsifies a record of what was played.
 *
 * Time is always passed in — the domain is forbidden an ambient clock, which
 * also lets the staleness rule be tested without waiting a minute for it.
 */

import { describe, it, expect } from 'vitest';
import { PlaybackSession, SESSION_STATE } from './PlaybackSession.mjs';
import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';

const T0 = 1_789_577_175_000;
const base = { surfaceId: 'livingroom-tv', contentId: 'plex:674737', at: T0 };

describe('PlaybackSession.start', () => {
  it('opens in playing state at the given position', () => {
    const s = PlaybackSession.start({ ...base, positionMs: 5_000, durationMs: 292_733 });
    expect(s.state).toBe(SESSION_STATE.playing);
    expect(s.positionMs).toBe(5_000);
    expect(s.durationMs).toBe(292_733);
    expect(s.lastHeartbeatAt).toBe(T0);
  });

  it('identifies a session by surface AND content, so two screens never collide', () => {
    const a = PlaybackSession.start({ ...base });
    const b = PlaybackSession.start({ ...base, surfaceId: 'garage-tv' });
    const c = PlaybackSession.start({ ...base, contentId: 'plex:999' });
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toBe(c.key);
    expect(a.key).toBe(PlaybackSession.start({ ...base }).key);
  });

  it('refuses a session with no surface or no content', () => {
    expect(() => PlaybackSession.start({ ...base, surfaceId: '' })).toThrow(ValidationError);
    expect(() => PlaybackSession.start({ ...base, contentId: '  ' })).toThrow(ValidationError);
  });

  it('refuses a nonsense position or instant', () => {
    expect(() => PlaybackSession.start({ ...base, positionMs: -1 })).toThrow(ValidationError);
    expect(() => PlaybackSession.start({ ...base, at: 0 })).toThrow(ValidationError);
    expect(() => PlaybackSession.start({ ...base, at: NaN })).toThrow(ValidationError);
  });
});

describe('PlaybackSession transitions', () => {
  it('advances the playhead and the heartbeat together', () => {
    const s = PlaybackSession.start({ ...base });
    s.advance({ positionMs: 15_000, at: T0 + 15_000 });
    expect(s.positionMs).toBe(15_000);
    expect(s.lastHeartbeatAt).toBe(T0 + 15_000);
    expect(s.state).toBe(SESSION_STATE.playing);
  });

  it('treats a keepalive at the same position as a real heartbeat', () => {
    const s = PlaybackSession.start({ ...base, positionMs: 15_000 });
    s.advance({ positionMs: 15_000, at: T0 + 10_000 });
    expect(s.lastHeartbeatAt).toBe(T0 + 10_000);
  });

  it('pauses and resumes', () => {
    const s = PlaybackSession.start({ ...base });
    s.pause({ at: T0 + 1_000 });
    expect(s.state).toBe(SESSION_STATE.paused);
    s.resume({ at: T0 + 2_000 });
    expect(s.state).toBe(SESSION_STATE.playing);
  });

  it('returns to playing when advanced out of a pause', () => {
    const s = PlaybackSession.start({ ...base });
    s.pause({ at: T0 + 1_000 });
    s.advance({ positionMs: 20_000, at: T0 + 2_000 });
    expect(s.state).toBe(SESSION_STATE.playing);
  });
});

describe('PlaybackSession stop is terminal', () => {
  it('stops', () => {
    const s = PlaybackSession.start({ ...base });
    s.stop({ at: T0 + 30_000 });
    expect(s.state).toBe(SESSION_STATE.stopped);
    expect(s.isStopped).toBe(true);
  });

  it('refuses to advance, pause or resume after stopping', () => {
    const s = PlaybackSession.start({ ...base });
    s.stop({ at: T0 + 30_000 });
    expect(() => s.advance({ positionMs: 40_000, at: T0 + 40_000 })).toThrow(DomainInvariantError);
    expect(() => s.pause({ at: T0 + 40_000 })).toThrow(DomainInvariantError);
    expect(() => s.resume({ at: T0 + 40_000 })).toThrow(DomainInvariantError);
  });

  it('treats a second stop as a no-op rather than an error', () => {
    const s = PlaybackSession.start({ ...base });
    s.stop({ at: T0 + 30_000 });
    expect(() => s.stop({ at: T0 + 60_000 })).not.toThrow();
    expect(s.lastHeartbeatAt).toBe(T0 + 30_000);
  });
});

describe('PlaybackSession.isStale', () => {
  it('is not stale while heartbeats keep arriving', () => {
    const s = PlaybackSession.start({ ...base });
    expect(s.isStale({ now: T0 + 30_000, ttlMs: 60_000 })).toBe(false);
  });

  it('goes stale once the surface stops talking', () => {
    const s = PlaybackSession.start({ ...base });
    expect(s.isStale({ now: T0 + 61_000, ttlMs: 60_000 })).toBe(true);
  });

  it('is never stale once stopped — there is nothing left to reap', () => {
    const s = PlaybackSession.start({ ...base });
    s.stop({ at: T0 });
    expect(s.isStale({ now: T0 + 600_000, ttlMs: 60_000 })).toBe(false);
  });
});
