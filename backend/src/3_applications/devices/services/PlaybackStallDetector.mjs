/**
 * PlaybackStallDetector — notices a player that says it is playing while the
 * playhead stands still.
 *
 * On 2026-08-16 the piano kiosk sat broken for 17 minutes with a child in front
 * of it. Every health check we owned was satisfied: the APK watchdog saw 37 fps,
 * the heartbeat arrived every second, and DeviceLivenessService asked only
 * whether a beat had arrived. The failure was semantic — media was requested and
 * media never advanced — and "stuck" was not a concept anywhere in the health
 * layer. This service is that concept.
 *
 * The signal costs nothing new: the 5s device-state heartbeat already carries
 * `state` and `position` (SessionSource's snapshot). This compares consecutive
 * positions for the same content and, when a device claims `playing` while the
 * playhead has not moved for `stallThresholdMs`, calls `onStall` exactly once.
 *
 * The rules for what counts as progress live in
 * `shared/contracts/media/playbackProgress.mjs`, shared with the kiosk-side
 * watch that files the feedback report — two detectors reading the same
 * heartbeat have to reach the same verdict. A detector that cries wolf gets
 * ignored, so the following are deliberately NOT stalls, and each is tested:
 *   - anything other than `playing` — paused, buffering (a long seek can sit
 *     there for minutes), loading, stalled, ended, error, idle. A frozen
 *     playhead is only anomalous when the player insists it is playing.
 *   - content with no finite positive duration, and content explicitly flagged
 *     `isLive`/`live`. A live edge has no meaningful position to advance.
 *   - the playhead parked at (or past) the end of the item — that is a tail, not
 *     a stall, and the end-of-content watchdog owns it.
 *   - a device with fewer than `minSamples` observations, or one whose whole
 *     window is two heartbeats far apart. Two beats an hour apart prove a
 *     reporting gap, not an observed stall.
 *   - a content change, which restarts the window rather than carrying the
 *     previous item's frozen time into the new one.
 *
 * Ordering and skew are handled with the SERVER clock, never the device's:
 * elapsed time comes from the injected clock at receipt, so a tablet with a wrong
 * date cannot fabricate or mask a stall. The payload `ts` is used only to drop
 * heartbeats that arrive out of order, and a backwards jump in the server clock
 * restarts the window rather than producing a negative or absurd duration.
 *
 * @module applications/devices/services
 */

import { parseDeviceTopic } from '#shared-contracts/media/topics.mjs';
import {
  POSITION_EPSILON_SEC,
  STALL_THRESHOLD_MS,
  STALL_MIN_SAMPLES,
  isStallableItem,
  isAtEndOfItem,
  positionAdvanced,
} from '#shared-contracts/media/playbackProgress.mjs';

/**
 * @typedef {Object} StallEntry
 * @property {string} contentKey      Identity of the item the window is about
 * @property {number} position        Last observed playhead position, seconds
 * @property {number} sinceAt         Server clock ms when the position last moved
 * @property {number} lastAt          Server clock ms of the last accepted beat
 * @property {number} lastTs          Payload timestamp ms of the last accepted beat
 * @property {number} samples         Beats accepted into the current window
 * @property {boolean} stalled        Whether an episode is currently open
 * @property {Object|null} item       Last observed currentItem
 */

export class PlaybackStallDetector {
  #eventBus;
  #logger;
  #clock;
  #stallThresholdMs;
  #minSamples;
  #positionEpsilonSec;
  #onStall;
  #onRecover;

  /** @type {Map<string, StallEntry>} */
  #entries = new Map();
  #unsubscribe = null;
  #started = false;

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus - Event bus exposing subscribePattern
   * @param {Object} [deps.logger]
   * @param {Object} [deps.clock] - { now(): number }; defaults to Date
   * @param {number} [deps.stallThresholdMs=60000]
   * @param {number} [deps.minSamples=3]
   * @param {number} [deps.positionEpsilonSec=0.25]
   * @param {Function} [deps.onStall] - ({ deviceId, contentId, title, position,
   *   stalledForMs, samples }) => void; called once per episode
   * @param {Function} [deps.onRecover] - ({ deviceId, stalledForMs, reason }) => void
   */
  constructor(deps = {}) {
    if (!deps.eventBus) {
      throw new TypeError('PlaybackStallDetector requires eventBus');
    }
    this.#eventBus = deps.eventBus;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#stallThresholdMs =
      typeof deps.stallThresholdMs === 'number' && deps.stallThresholdMs > 0
        ? deps.stallThresholdMs
        : STALL_THRESHOLD_MS;
    this.#minSamples =
      typeof deps.minSamples === 'number' && deps.minSamples > 1
        ? deps.minSamples
        : STALL_MIN_SAMPLES;
    this.#positionEpsilonSec =
      typeof deps.positionEpsilonSec === 'number' && deps.positionEpsilonSec >= 0
        ? deps.positionEpsilonSec
        : POSITION_EPSILON_SEC;
    this.#onStall = typeof deps.onStall === 'function' ? deps.onStall : null;
    this.#onRecover = typeof deps.onRecover === 'function' ? deps.onRecover : null;
  }

  /** Begin observing device-state broadcasts. Idempotent. */
  start() {
    if (this.#started) return;
    this.#started = true;

    this.#logger.info?.('playback-stall.start', {
      stallThresholdMs: this.#stallThresholdMs,
      minSamples: this.#minSamples,
    });

    if (typeof this.#eventBus.subscribePattern === 'function') {
      this.#unsubscribe = this.#eventBus.subscribePattern(
        (topic) => {
          const parsed = parseDeviceTopic(topic);
          return !!parsed && parsed.kind === 'device-state';
        },
        (payload, topic) => this.#handleDeviceState(topic, payload),
      );
    } else {
      this.#logger.warn?.('playback-stall.no_subscribe_pattern', {
        note: 'event bus lacks subscribePattern — stall detection inactive',
      });
    }
  }

  /** Stop observing the bus. Idempotent. */
  stop() {
    if (!this.#started) return;
    this.#started = false;

    if (typeof this.#unsubscribe === 'function') {
      try { this.#unsubscribe(); } catch {
        // ignore — teardown is best-effort
      }
      this.#unsubscribe = null;
    }

    this.#logger.info?.('playback-stall.stop');
  }

  /**
   * Whether a device currently has an open stall episode.
   * @param {string} deviceId
   * @returns {boolean}
   */
  isStalled(deviceId) {
    return this.#entries.get(deviceId)?.stalled === true;
  }

  /**
   * The tracking window for a device, for diagnostics and tests.
   * @param {string} deviceId
   * @returns {null | { contentKey: string, position: number, samples: number,
   *   stalled: boolean, frozenForMs: number }}
   */
  getStallState(deviceId) {
    const entry = this.#entries.get(deviceId);
    if (!entry) return null;
    return {
      contentKey: entry.contentKey,
      position: entry.position,
      samples: entry.samples,
      stalled: entry.stalled,
      frozenForMs: Math.max(0, entry.lastAt - entry.sinceAt),
    };
  }

  /** Device ids with an open stall episode. */
  stalledDeviceIds() {
    return [...this.#entries.entries()].filter(([, e]) => e.stalled).map(([id]) => id);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Process one device-state broadcast.
   * @private
   */
  #handleDeviceState(topic, payload) {
    if (!payload || typeof payload !== 'object') return;

    const deviceId = payload.deviceId;
    if (!deviceId || typeof deviceId !== 'string') return;

    // Synthesized offline broadcasts re-enter this handler because pattern
    // subscribers fire on every publish. They replay a stale snapshot, so
    // treating them as fresh observations would age a window that nobody is
    // actually reporting into.
    if (payload.reason === 'offline') return;

    const snapshot = payload.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return;

    const now = this.#clock.now();
    const prev = this.#entries.get(deviceId);

    // Drop a heartbeat that carries an older payload timestamp than the last one
    // we accepted. Delayed duplicates arrive with a stale position, and reading
    // one as the current position would either mask a stall or invent one.
    const ts = Date.parse(payload.ts ?? snapshot.meta?.updatedAt ?? '');
    if (prev && Number.isFinite(ts) && Number.isFinite(prev.lastTs) && ts < prev.lastTs) {
      this.#logger.debug?.('playback-stall.out_of_order', { deviceId, ts: payload.ts });
      return;
    }

    // Only a device insisting it is playing can be stuck. Everything else —
    // paused, buffering a long seek, loading, ended — has a legitimate reason
    // for a motionless playhead, so the window closes and any open episode
    // resolves.
    if (snapshot.state !== 'playing' || !isStallableItem(snapshot.currentItem)) {
      if (prev?.stalled) this.#resolve(deviceId, prev, snapshot.state === 'playing' ? 'content' : snapshot.state);
      this.#entries.delete(deviceId);
      return;
    }

    const position = typeof snapshot.position === 'number' && Number.isFinite(snapshot.position)
      ? snapshot.position
      : 0;
    const item = snapshot.currentItem;
    const contentKey = this.#contentKey(item);

    // The playhead parked on the last second of an item is a tail, not a stall.
    if (isAtEndOfItem(item, position)) {
      if (prev?.stalled) this.#resolve(deviceId, prev, 'end-of-item');
      this.#entries.delete(deviceId);
      return;
    }

    // A new item, a backwards jump in the server clock, or a first sighting all
    // mean there is no window to extend — start one.
    const clockWentBackwards = !!prev && now < prev.lastAt;
    if (!prev || prev.contentKey !== contentKey || clockWentBackwards) {
      if (prev?.stalled) this.#resolve(deviceId, prev, clockWentBackwards ? 'clock-skew' : 'content-change');
      this.#entries.set(deviceId, {
        contentKey,
        position,
        sinceAt: now,
        lastAt: now,
        lastTs: Number.isFinite(ts) ? ts : now,
        samples: 1,
        stalled: false,
        item,
      });
      return;
    }

    prev.lastAt = now;
    if (Number.isFinite(ts)) prev.lastTs = ts;
    prev.samples += 1;
    prev.item = item;

    // Any movement counts, in either direction: a seek backwards is progress
    // too, because it proves the player is responding.
    if (positionAdvanced(prev.position, position, this.#positionEpsilonSec)) {
      if (prev.stalled) this.#resolve(deviceId, prev, 'advancing');
      prev.position = position;
      prev.sinceAt = now;
      return;
    }

    const frozenForMs = now - prev.sinceAt;
    if (!prev.stalled && frozenForMs >= this.#stallThresholdMs && prev.samples >= this.#minSamples) {
      prev.stalled = true;
      this.#logger.warn?.('playback-stall.detected', {
        deviceId,
        contentId: item?.contentId ?? null,
        position,
        stalledForMs: frozenForMs,
        samples: prev.samples,
      });
      this.#fire(this.#onStall, 'playback-stall.on_stall_failed', {
        deviceId,
        contentId: item?.contentId ?? null,
        title: item?.title ?? null,
        position,
        stalledForMs: frozenForMs,
        samples: prev.samples,
      });
    }
  }

  /**
   * Close an open episode and tell the caller it is over.
   * @private
   */
  #resolve(deviceId, entry, reason) {
    entry.stalled = false;
    const stalledForMs = Math.max(0, entry.lastAt - entry.sinceAt);
    this.#logger.info?.('playback-stall.recovered', { deviceId, reason, stalledForMs });
    this.#fire(this.#onRecover, 'playback-stall.on_recover_failed', {
      deviceId,
      reason,
      stalledForMs,
    });
  }

  /**
   * Call a caller-supplied handler without letting it tear down the detector —
   * a notification transport failing must not stop us noticing the next stall.
   * @private
   */
  #fire(handler, failureEvent, arg) {
    if (!handler) return;
    try {
      handler(arg);
    } catch (err) {
      this.#logger.error?.(failureEvent, { deviceId: arg?.deviceId, error: err?.message });
    }
  }

  /** @private */
  #contentKey(item) {
    return String(item?.contentId ?? item?.queueItemId ?? item?.title ?? 'unknown');
  }
}

export default PlaybackStallDetector;
