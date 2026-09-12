import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { PlayState, assertPlayState, accrues } from '../value-objects/PlayState.mjs';

/**
 * A period during which a person is actually playing a game on a device.
 *
 * The entity owns one question: how much time was ACTUALLY played? It answers
 * it by folding a stream of observations, never by subtracting timestamps.
 * `endedAt - startedAt` is wall-clock; a paused, backgrounded or abandoned game
 * would be billed as play. `playedMs` is the sum of intervals we actually
 * watched the surface play.
 *
 * Three invariants carry the money:
 *
 *  1. A session becomes ACTIVE only on the first PLAYING observation. Launching
 *     a game is an intent; playing it is an observation. A launch that never
 *     produces play must never bill.
 *  2. `playedMs` is a monotonic high-water mark. It never decreases, which is
 *     what makes duplicated, retried and replayed observations safe.
 *  3. An interval longer than the trusted window is only credited up to that
 *     window. A silent observer must not be able to bill the silence — the
 *     remainder is a blind spot for reconciliation to settle, not free revenue.
 *
 * Pure: the caller supplies every timestamp. The domain owns no clock.
 */

export const PlaySessionStatus = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  ENDED: 'ended',
});

export const PlaySessionEndReason = Object.freeze({
  QUIT: 'quit',
  EXPIRED: 'expired',
  LOST: 'lost',
});

const END_REASONS = new Set(Object.values(PlaySessionEndReason));

function toMillis(value, field) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new ValidationError(`${field} must be a valid timestamp`, {
      code: 'INVALID_TIMESTAMP', field, value,
    });
  }
  return ms;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`, { code: 'MISSING_FIELD', field, value });
  }
  return value;
}

export class PlaySession {
  #id; #deviceId; #surface; #userId; #content; #grantRef; #participants;
  #status; #startedAt; #endedAt; #endReason;
  #playedMs; #lastState; #lastObservedAt; #confidenceMs; #trustedGapMs;

  constructor({
    id, deviceId, surface, userId = null, content = null, grantRef = null, participants = [],
    status = PlaySessionStatus.PENDING,
    startedAt = null, endedAt = null, endReason = null,
    playedMs = 0, lastState = null, lastObservedAt = null,
    confidenceMs = 0, trustedGapMs,
  }) {
    this.#id = requireText(id, 'id');
    this.#deviceId = requireText(deviceId, 'deviceId');
    this.#surface = requireText(surface, 'surface');
    if (!Number.isFinite(trustedGapMs) || trustedGapMs <= 0) {
      throw new ValidationError('trustedGapMs must be a positive number of milliseconds', {
        code: 'INVALID_TRUSTED_GAP', field: 'trustedGapMs', value: trustedGapMs,
      });
    }
    this.#userId = userId;
    this.#content = content;
    this.#grantRef = grantRef;
    this.#participants = Array.from(new Set(participants.filter(Boolean)));
    this.#status = status;
    this.#startedAt = startedAt;
    this.#endedAt = endedAt;
    this.#endReason = endReason;
    this.#playedMs = playedMs;
    this.#lastState = lastState;
    this.#lastObservedAt = lastObservedAt;
    this.#confidenceMs = confidenceMs;
    this.#trustedGapMs = trustedGapMs;
  }

  /**
   * Open a session in response to a launch. It is PENDING, not ACTIVE: nothing
   * is billable until a PLAYING observation confirms the game is really running.
   */
  static open({ id, deviceId, surface, userId = null, content = null, grantRef = null, participants = [], trustedGapMs }) {
    return new PlaySession({ id, deviceId, surface, userId, content, grantRef, participants, trustedGapMs });
  }

  get id() { return this.#id; }
  get deviceId() { return this.#deviceId; }
  get surface() { return this.#surface; }
  get userId() { return this.#userId; }
  get content() { return this.#content; }
  /** The authorisation this session was opened against (7.1). */
  get grantRef() { return this.#grantRef; }
  /**
   * Who is PAYING. A group session is charged to one person — a child spending
   * on behalf of siblings, or an adult covering the room — because splitting a
   * balance across children needs every one of them to have authorised, which
   * a couch does not make practical.
   */
  get payerId() { return this.#userId; }
  /**
   * Everyone recorded as present, payer included. Not charged today; recorded so
   * cost-splitting remains possible later without rewriting history.
   */
  get participants() { return [...this.#participants]; }
  get status() { return this.#status; }
  get startedAt() { return this.#startedAt; }
  get endedAt() { return this.#endedAt; }
  get endReason() { return this.#endReason; }
  get playedMs() { return this.#playedMs; }
  get lastState() { return this.#lastState; }
  get lastObservedAt() { return this.#lastObservedAt; }
  /** Worst-case error in `playedMs`, in ms — the bound we quote, never hide. */
  get confidenceMs() { return this.#confidenceMs; }

  isActive() { return this.#status === PlaySessionStatus.ACTIVE; }
  isEnded() { return this.#status === PlaySessionStatus.ENDED; }

  /**
   * Fold one observation into the session.
   *
   * @param {Object} observation
   * @param {'playing'|'paused'|'unknown'} observation.state
   * @param {Date|string|number} observation.observedAt
   * @param {number} [observation.confidenceMs] Accuracy bound of this probe.
   * @returns {{started: boolean, accruedMs: number, stale: boolean, truncatedMs: number}}
   */
  observe({ state, observedAt, confidenceMs = 0 }) {
    if (this.#status === PlaySessionStatus.ENDED) {
      throw new DomainInvariantError('Cannot observe an ended play session', {
        code: 'PLAY_SESSION_ENDED', sessionId: this.#id,
      });
    }
    assertPlayState(state);
    const at = toMillis(observedAt, 'observedAt');
    const previousAt = this.#lastObservedAt === null ? null : toMillis(this.#lastObservedAt, 'lastObservedAt');

    // Out-of-order and duplicate observations are ignored rather than rewinding
    // state. Replay safety is a property of the entity, not of the transport.
    if (previousAt !== null && at <= previousAt) {
      return { started: false, accruedMs: 0, stale: true, truncatedMs: 0 };
    }

    let started = false;
    if (this.#status === PlaySessionStatus.PENDING && accrues(state)) {
      this.#status = PlaySessionStatus.ACTIVE;
      this.#startedAt = new Date(at).toISOString();
      started = true;
    }

    // Only a PLAYING→PLAYING span is evidence that play happened throughout it.
    let accruedMs = 0;
    let truncatedMs = 0;
    if (previousAt !== null && accrues(this.#lastState) && accrues(state)) {
      const elapsed = at - previousAt;
      accruedMs = Math.min(elapsed, this.#trustedGapMs);
      truncatedMs = elapsed - accruedMs;
      this.#playedMs += accruedMs;
    }

    this.#lastState = state;
    this.#lastObservedAt = new Date(at).toISOString();
    if (confidenceMs > this.#confidenceMs) this.#confidenceMs = confidenceMs;

    return { started, accruedMs, stale: false, truncatedMs };
  }

  /**
   * Raise `playedMs` from after-the-fact evidence (e.g. on-device session logs
   * recovered once observation returns). Reconciliation may only ever raise the
   * high-water mark: lowering it would let a blind spot erase time already
   * witnessed.
   */
  /**
   * Record someone else as present. Idempotent, and never changes who pays:
   * joining a game must not silently move the bill to a sibling.
   */
  addParticipant(userId) {
    if (!userId || this.#participants.includes(userId)) return this;
    if (this.#status === PlaySessionStatus.ENDED) {
      throw new DomainInvariantError('Cannot add a participant to an ended play session', {
        code: 'PLAY_SESSION_ENDED', sessionId: this.#id,
      });
    }
    this.#participants.push(userId);
    return this;
  }

  reconcilePlayedMs(playedMs, { confidenceMs = 0 } = {}) {
    if (!Number.isFinite(playedMs) || playedMs < 0) {
      throw new ValidationError('playedMs must be a non-negative number', {
        code: 'INVALID_PLAYED_MS', field: 'playedMs', value: playedMs,
      });
    }
    const raisedBy = Math.max(0, playedMs - this.#playedMs);
    if (raisedBy > 0) this.#playedMs = playedMs;
    if (confidenceMs > this.#confidenceMs) this.#confidenceMs = confidenceMs;
    return { raisedBy };
  }

  end({ endedAt, reason }) {
    if (this.#status === PlaySessionStatus.ENDED) {
      throw new DomainInvariantError('Play session already ended', {
        code: 'PLAY_SESSION_ENDED', sessionId: this.#id,
      });
    }
    if (!END_REASONS.has(reason)) {
      throw new ValidationError(`Unknown end reason: ${JSON.stringify(reason)}`, {
        code: 'INVALID_END_REASON', field: 'reason', value: reason,
      });
    }
    this.#status = PlaySessionStatus.ENDED;
    this.#endedAt = new Date(toMillis(endedAt, 'endedAt')).toISOString();
    this.#endReason = reason;
    return this;
  }

  toSnapshot() {
    return {
      id: this.#id, deviceId: this.#deviceId, surface: this.#surface,
      userId: this.#userId, content: this.#content, grantRef: this.#grantRef,
      participants: [...this.#participants], status: this.#status,
      startedAt: this.#startedAt, endedAt: this.#endedAt, endReason: this.#endReason,
      playedMs: this.#playedMs, lastState: this.#lastState,
      lastObservedAt: this.#lastObservedAt, confidenceMs: this.#confidenceMs,
      trustedGapMs: this.#trustedGapMs,
    };
  }

  static fromSnapshot(snapshot) {
    return new PlaySession(snapshot);
  }
}

export default PlaySession;
