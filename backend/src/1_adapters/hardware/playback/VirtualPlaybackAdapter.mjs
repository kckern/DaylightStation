/**
 * VirtualPlaybackAdapter — a TV and a pair of headsets that do not exist.
 *
 * Stands in for the media-handoff leg of the School console: a work session
 * dispatches content to a target, gets a correlator back, and later hears a
 * completion signal. Per the console architecture spec, only completion releases
 * the linked quiz/form — starting playback is never completion — so the double's
 * whole job is to let a test produce completion, partial progress, and a stall
 * on demand.
 *
 * Shapes borrowed from the real seams:
 *  - `getStatus()` returns `SlotStatus[]`, exactly like
 *    {@link HttpPlaybackHubAdapter#getStatus}, built through `SlotStatus.fromHubJson`
 *    so the wire shape cannot drift.
 *  - `contentId` is split on the hub adapter's convention: a bare id is a Plex id,
 *    a prefixed `source:id` keeps its source.
 *  - Progress/completion events carry `seconds` + `percent`, the vocabulary
 *    `POST /play/log` already uses, so the correlation code written in Phase F
 *    reads the same fields for real screens and for this double.
 *
 * ASSUMPTION (RESOLVED 2026-08-27): the bus topic (`school-playback`) and the
 * event `type` values (`dispatched`/`progress`/`complete`/`stop`) were chosen
 * here because the work session lifecycle that consumes them was not yet built.
 * `ScreenPlaybackAdapter` — the real §8 target — KEPT ALL OF THEM unchanged.
 *
 * ONE thing widened when it landed, and it widened HERE TOO so the two cannot
 * drift: `dispatch()` now takes a REQUIRED `sessionId`, carried on the record
 * and on every emitted frame. The real screen adapter broadcasts
 * `lesson.open` with it and the screen fetches its lesson by it, so a dispatch
 * that cannot name its session is one no screen could act on. It is required
 * in this double rather than defaulted, because a double that tolerated its
 * absence would let a caller that forgot it pass the tests and fail in the
 * living room. `tests/_lib/school/lifecycleFakes.mjs`'s `FakePlayback` is the
 * third implementation of this port and carries the same field.
 *
 * @module adapters/hardware/playback
 */
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { SlotStatus } from '#domains/playback-hub/value-objects/SlotStatus.mjs';

const SOURCE = 'virtual-playback';
const DEFAULT_TOPIC = 'school-playback';

/** `plex:670208` → {source:'plex', id:'670208'}; `670208` → the same (hub convention). */
function splitContentId(contentId) {
  const idx = contentId.indexOf(':');
  if (idx <= 0) return { source: 'plex', id: contentId };
  return { source: contentId.slice(0, idx), id: contentId.slice(idx + 1) };
}

export class VirtualPlaybackAdapter {
  #eventBus; #topic; #logger; #clock;
  #targets = [];
  #seq = 0;
  #dispatches = [];

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus - IEventBus; only `broadcast` is used
   * @param {string[]} [deps.targets=[]] - known playback targets, in slot order
   * @param {string} [deps.topic='school-playback']
   * @param {Object} [deps.logger=console]
   * @param {() => Date} [deps.clock]
   */
  constructor({ eventBus, targets = [], topic = DEFAULT_TOPIC, logger = console, clock = () => new Date() } = {}) {
    if (!eventBus || typeof eventBus.broadcast !== 'function') {
      throw new InfrastructureError('VirtualPlaybackAdapter requires eventBus.broadcast', {
        code: 'MISSING_DEPENDENCY', dependency: 'eventBus',
      });
    }
    this.#eventBus = eventBus;
    this.#targets = [...targets];
    this.#topic = topic;
    this.#logger = logger;
    this.#clock = clock;
  }

  /**
   * Hand content to a playback target.
   *
   * @param {Object} args
   * @param {string} args.target
   * @param {string} args.contentId
   * @param {string} args.sessionId - the work session this dispatch belongs to
   * @param {string} [args.learnerId]
   * @param {number} [args.durationSec=0]
   * @returns {Object} dispatch record; `dispatchId` is the correlator the session stores
   */
  dispatch({ target, contentId, sessionId, learnerId = null, durationSec = 0 } = {}) {
    if (typeof target !== 'string' || !target.trim()) {
      throw new InfrastructureError('dispatch requires a target', { code: 'INVALID_DISPATCH', field: 'target', value: target });
    }
    if (typeof contentId !== 'string' || !contentId.trim()) {
      throw new InfrastructureError('dispatch requires a contentId', { code: 'INVALID_DISPATCH', field: 'contentId', value: contentId });
    }
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new InfrastructureError('dispatch requires a sessionId', { code: 'INVALID_DISPATCH', field: 'sessionId', value: sessionId });
    }
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) {
      throw new InfrastructureError('dispatch requires a non-negative durationSec', { code: 'INVALID_DISPATCH', field: 'durationSec', value: durationSec });
    }

    if (!this.#targets.includes(target)) this.#targets.push(target);

    const record = {
      dispatchId: `dsp_${String(++this.#seq).padStart(4, '0')}`,
      target,
      contentId,
      learnerId,
      sessionId,
      durationSec,
      positionSec: 0,
      status: 'playing',
      startedAt: this.#clock().toISOString(),
      endedAt: null,
    };
    this.#dispatches.push(record);
    this.#emit('dispatched', record);
    this.#logger.info?.('virtual-playback.dispatched', { dispatchId: record.dispatchId, target, contentId, learnerId });
    return { ...record };
  }

  /**
   * Move the playhead forward without completing. Clamps at `durationSec` —
   * reaching the end is not the same as being verified complete.
   *
   * @param {string} dispatchId
   * @param {number} seconds
   * @returns {Object} updated record
   */
  advance(dispatchId, seconds) {
    const record = this.#require(dispatchId);
    this.#requirePlaying(record, 'advance');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new InfrastructureError('advance requires a positive number of seconds', {
        code: 'INVALID_ADVANCE', dispatchId, value: seconds,
      });
    }
    record.positionSec = record.durationSec > 0
      ? Math.min(record.durationSec, record.positionSec + seconds)
      : record.positionSec + seconds;
    this.#emit('progress', record);
    return { ...record };
  }

  /**
   * Play through to the end and emit the completion signal the lifecycle
   * correlates on. Idempotent: replaying a completed dispatch emits nothing.
   *
   * @param {string} dispatchId
   * @returns {Object} updated record
   */
  playToEnd(dispatchId) {
    const record = this.#require(dispatchId);
    if (record.status === 'completed') return { ...record };
    this.#requirePlaying(record, 'playToEnd');
    record.positionSec = record.durationSec;
    record.status = 'completed';
    record.endedAt = this.#clock().toISOString();
    this.#emit('complete', record);
    this.#logger.info?.('virtual-playback.complete', { dispatchId, target: record.target, learnerId: record.learnerId });
    return { ...record };
  }

  /**
   * Stop mid-content. Records the stop and emits NO completion — this is the
   * stall path the session has to notice by timeout rather than by signal.
   *
   * @param {string} dispatchId
   * @returns {Object} updated record
   */
  interrupt(dispatchId) {
    const record = this.#require(dispatchId);
    if (record.status === 'stopped') return { ...record };
    this.#requirePlaying(record, 'interrupt');
    record.status = 'stopped';
    record.endedAt = this.#clock().toISOString();
    this.#emit('stop', record);
    this.#logger.info?.('virtual-playback.interrupted', { dispatchId, positionSec: record.positionSec });
    return { ...record };
  }

  /**
   * @returns {SlotStatus[]} one slot per known target, in the hub's status shape
   */
  getStatus() {
    return this.#targets.map((target, i) => {
      const live = [...this.#dispatches].reverse().find((d) => d.target === target && d.status === 'playing');
      return SlotStatus.fromHubJson({
        slot: i + 1,
        color: target,
        bt_connected: true,
        paused: false,
        now_playing: live ? { queue: splitContentId(live.contentId) } : null,
        volume: live ? 45 : null,
        playlist_pos: live ? 0 : null,
        playlist_count: live ? 1 : null,
        armed_source: null,
      });
    });
  }

  /** @returns {Array<Object>} dispatch records in order */
  listDispatches() {
    return this.#dispatches.map((d) => ({ ...d }));
  }

  /**
   * @param {string} dispatchId
   * @returns {Object|null}
   */
  getDispatch(dispatchId) {
    const found = this.#dispatches.find((d) => d.dispatchId === dispatchId);
    return found ? { ...found } : null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  #require(dispatchId) {
    const found = this.#dispatches.find((d) => d.dispatchId === dispatchId);
    if (!found) {
      throw new InfrastructureError(`unknown dispatch ${dispatchId}`, { code: 'UNKNOWN_DISPATCH', dispatchId });
    }
    return found;
  }

  #requirePlaying(record, op) {
    if (record.status !== 'playing') {
      throw new InfrastructureError(`cannot ${op}: dispatch ${record.dispatchId} is ${record.status}`, {
        code: 'INVALID_DISPATCH_STATE', dispatchId: record.dispatchId, status: record.status, op,
      });
    }
  }

  #emit(type, record) {
    this.#eventBus.broadcast(this.#topic, {
      source: SOURCE,
      type,
      dispatchId: record.dispatchId,
      target: record.target,
      contentId: record.contentId,
      learnerId: record.learnerId,
      sessionId: record.sessionId,
      seconds: record.positionSec,
      durationSec: record.durationSec,
      percent: record.durationSec > 0 ? Math.round((record.positionSec / record.durationSec) * 100) : 0,
      ts: this.#clock().toISOString(),
    });
  }
}

export default VirtualPlaybackAdapter;
