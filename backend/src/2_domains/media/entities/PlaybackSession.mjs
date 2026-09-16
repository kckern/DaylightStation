/**
 * PlaybackSession — one surface playing one thing, right now.
 *
 * Identity is `(surfaceId, contentId)`: the living room playing a story is not
 * the same session as the garage playing a workout, and a surface holds at most
 * one open session. Switching content SUPERSEDES rather than stacks — otherwise
 * a child changing stories would show two things playing on one screen.
 *
 * `stopped` is terminal. A stopped session is evidence of something that
 * happened; re-opening it would falsify that record, so callers must start a
 * new session instead.
 *
 * NO CLOCK. Every transition takes the instant as a parameter. The domain layer
 * is forbidden ambient time (`domains-no-ambient-clock`), and it makes the
 * staleness rule testable without waiting a minute for it.
 */

import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';

/** @type {const} */
export const SESSION_STATE = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  stopped: 'stopped',
});

function requireId(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`PlaybackSession.${field} is required`, { field, value });
  }
  return value.trim();
}

function requireMs(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`PlaybackSession.${field} must be a non-negative number`, { field, value });
  }
  return Math.round(n);
}

function requireInstant(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`PlaybackSession.${field} must be an epoch milliseconds value`, { field, value });
  }
  return Math.round(n);
}

export class PlaybackSession {
  #surfaceId;
  #contentId;
  #state;
  #positionMs;
  #durationMs;
  #lastHeartbeatAt;

  constructor({ surfaceId, contentId, state, positionMs, durationMs, lastHeartbeatAt }) {
    this.#surfaceId = requireId(surfaceId, 'surfaceId');
    this.#contentId = requireId(contentId, 'contentId');
    if (!Object.values(SESSION_STATE).includes(state)) {
      throw new ValidationError(`PlaybackSession.state is not a known state`, { field: 'state', value: state });
    }
    this.#state = state;
    this.#positionMs = requireMs(positionMs, 'positionMs');
    this.#durationMs = requireMs(durationMs, 'durationMs');
    this.#lastHeartbeatAt = requireInstant(lastHeartbeatAt, 'lastHeartbeatAt');
  }

  /**
   * Open a session. This is the only way one comes into being in `playing`.
   * @param {{surfaceId: string, contentId: string, positionMs?: number, durationMs?: number, at: number}} props
   */
  static start({ surfaceId, contentId, positionMs = 0, durationMs = 0, at }) {
    return new PlaybackSession({
      surfaceId,
      contentId,
      state: SESSION_STATE.playing,
      positionMs,
      durationMs,
      lastHeartbeatAt: at,
    });
  }

  get surfaceId() { return this.#surfaceId; }
  get contentId() { return this.#contentId; }
  get state() { return this.#state; }
  get positionMs() { return this.#positionMs; }
  get durationMs() { return this.#durationMs; }
  get lastHeartbeatAt() { return this.#lastHeartbeatAt; }

  /** `(surfaceId, contentId)` — what makes two sessions the same session. */
  get key() { return `${this.#surfaceId}::${this.#contentId}`; }

  get isStopped() { return this.#state === SESSION_STATE.stopped; }

  #refuseIfStopped(action) {
    if (this.isStopped) {
      // DomainInvariantError's shape is (message, { code, details }) — context
      // must go inside `details` or it is silently dropped.
      throw new DomainInvariantError(`Cannot ${action} a stopped session`, {
        code: 'SESSION_STOPPED',
        details: { surfaceId: this.#surfaceId, contentId: this.#contentId },
      });
    }
  }

  /**
   * A heartbeat: the playhead moved (or held) and the session is alive.
   * Position may stay put — a keepalive during a buffer is still a heartbeat.
   */
  advance({ positionMs, durationMs, at }) {
    this.#refuseIfStopped('advance');
    this.#positionMs = requireMs(positionMs, 'positionMs');
    if (durationMs !== undefined) this.#durationMs = requireMs(durationMs, 'durationMs');
    this.#lastHeartbeatAt = requireInstant(at, 'at');
    this.#state = SESSION_STATE.playing;
    return this;
  }

  pause({ at }) {
    this.#refuseIfStopped('pause');
    this.#lastHeartbeatAt = requireInstant(at, 'at');
    this.#state = SESSION_STATE.paused;
    return this;
  }

  resume({ at }) {
    this.#refuseIfStopped('resume');
    this.#lastHeartbeatAt = requireInstant(at, 'at');
    this.#state = SESSION_STATE.playing;
    return this;
  }

  /** Terminal. Stopping an already-stopped session is a no-op, not an error. */
  stop({ at }) {
    if (this.isStopped) return this;
    this.#lastHeartbeatAt = requireInstant(at, 'at');
    this.#state = SESSION_STATE.stopped;
    return this;
  }

  /**
   * Has this session gone quiet long enough to be presumed dead?
   *
   * A surface that crashes mid-play never sends a stop, and Plex would show it
   * playing forever. The reaper uses this.
   */
  isStale({ now, ttlMs }) {
    const at = requireInstant(now, 'now');
    const ttl = requireMs(ttlMs, 'ttlMs');
    return !this.isStopped && (at - this.#lastHeartbeatAt) > ttl;
  }
}

export default PlaybackSession;
