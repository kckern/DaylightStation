/**
 * HubFleetBridge - projects playback-hub lane status into Fleet device-state.
 *
 * Long-running service (sibling of HubStatusBroadcaster). Subscribes to the
 * `playback-hub:status` snapshots the broadcaster publishes every ~3s and,
 * for each Bluetooth speaker lane, broadcasts a Fleet-compatible
 * SessionSnapshot on `device-state:<deviceId>` so the /media app's Fleet
 * ("Devices") view shows the speakers with live now-playing state.
 *
 * Device id scheme: `speaker-<laneKey>` where laneKey is the hub lane color
 * (e.g. `speaker-red`, `speaker-white`). Matching entries must exist in
 * devices.yml (with `fleet: true`) for the Fleet roster to render them.
 *
 * State mapping (SlotStatus -> SessionSnapshot.state):
 *   - now_playing == null            -> 'idle'
 *   - now_playing set && paused      -> 'paused'
 *   - now_playing set && !paused     -> 'playing'
 *
 * Publish discipline:
 *   - Publish ONLY when the mapped snapshot materially changes
 *     (reason 'initial' on first sight of a lane, 'change' after).
 *   - While a lane has an active session (playing/paused), re-publish a
 *     `heartbeat` every ~10s (driven by the incoming 3s status ticks — no
 *     extra timer) so DeviceLivenessService keeps the device online.
 *   - Idle lanes get no heartbeats: after ~15s of silence the liveness
 *     service flips them offline, which is the desired Fleet rendering for
 *     a disconnected/quiet speaker. If the hub itself goes dark, ticks stop
 *     and every lane ages out the same way.
 *
 * Defensive: malformed status payloads / lane entries are skipped (debug
 * log), and the subscription handler never throws.
 */

import {
  buildDeviceStateBroadcast,
} from '#shared-contracts/media/envelopes.mjs';
import {
  DEVICE_STATE_TOPIC,
} from '#shared-contracts/media/topics.mjs';
import {
  createEmptyQueueSnapshot,
} from '#shared-contracts/media/shapes.mjs';

export const HUB_STATUS_TOPIC = 'playback-hub:status';
export const SPEAKER_DEVICE_ID_PREFIX = 'speaker-';

const DEFAULT_HEARTBEAT_MS = 10000;

/** @returns {boolean} */
function isPlainObjectLike(v) {
  return v !== null && typeof v === 'object';
}

/**
 * Map one hub lane (SlotStatus VO or its JSON shape) to a SessionSnapshot.
 * Returns null when the lane entry is malformed.
 *
 * @param {object} lane
 * @param {string} nowIso
 * @returns {{ deviceId: string, snapshot: object } | null}
 */
export function mapLaneToSnapshot(lane, nowIso) {
  if (!isPlainObjectLike(lane)) return null;
  const color = lane.color;
  if (typeof color !== 'string' || color.length === 0) return null;

  const deviceId = `${SPEAKER_DEVICE_ID_PREFIX}${color}`;

  const np = lane.now_playing;
  const hasTrack = isPlainObjectLike(np);
  const paused = lane.paused === true;
  const state = hasTrack ? (paused ? 'paused' : 'playing') : 'idle';

  let currentItem = null;
  if (hasTrack) {
    // Stable content ref: "<source>:<id>" (e.g. "plex:675465"); fall back to
    // a lane-scoped ref if the queue shape is unexpectedly missing.
    const queue = isPlainObjectLike(np.queue) ? np.queue : null;
    const contentId = (queue && typeof queue.source === 'string' && typeof queue.id === 'string'
      && queue.source.length > 0 && queue.id.length > 0)
      ? `${queue.source}:${queue.id}`
      : `playback-hub:${color}`;
    currentItem = { contentId, format: 'audio' };
    if (typeof np.title === 'string' && np.title.length > 0) {
      currentItem.title = np.title;
    }
    if (typeof np.artist === 'string' && np.artist.length > 0) {
      currentItem.artist = np.artist;
    }
    if (typeof np.duration === 'number' && Number.isFinite(np.duration) && np.duration >= 0) {
      currentItem.duration = np.duration;
    }
  }

  // The hub's SlotStatus doesn't carry playback seconds (its `position` is
  // the slot number) — expose it if a numeric `time_pos` ever appears,
  // otherwise 0 (contract requires a non-negative number).
  const position = (typeof lane.time_pos === 'number' && Number.isFinite(lane.time_pos) && lane.time_pos >= 0)
    ? lane.time_pos
    : 0;

  const queueSnapshot = createEmptyQueueSnapshot();
  if (Number.isInteger(lane.playlist_pos) && lane.playlist_pos >= 0) {
    queueSnapshot.currentIndex = lane.playlist_pos;
  }

  const rawVolume = lane.volume;
  const volume = (typeof rawVolume === 'number' && Number.isFinite(rawVolume))
    ? Math.min(100, Math.max(0, Math.round(rawVolume)))
    : 50;

  return {
    deviceId,
    snapshot: {
      sessionId: `playback-hub-${color}`,
      state,
      currentItem,
      position,
      queue: queueSnapshot,
      config: { shuffle: false, repeat: 'off', shader: null, volume, playbackRate: 1.0 },
      meta: { ownerId: deviceId, updatedAt: nowIso },
    },
  };
}

export class HubFleetBridge {
  /** @type {{ subscribe: Function, broadcast?: Function, publish?: Function }} */ #eventBus;
  /** @type {object} */ #logger;
  /** @type {number} */ #heartbeatMs;
  /** @type {{ now: () => number }} */ #clock;

  /** @type {Function|null} */ #unsubscribe = null;
  #started = false;

  /**
   * Per-lane publish bookkeeping.
   * @type {Map<string, { fingerprint: string, state: string, lastPublishedAt: number }>}
   */
  #lanes = new Map();

  /**
   * @param {{
   *   eventBus: { subscribe: Function, broadcast?: Function, publish?: Function },
   *   logger?: object,
   *   heartbeatMs?: number,
   *   clock?: { now: () => number }
   * }} deps
   */
  constructor({ eventBus, logger, heartbeatMs = DEFAULT_HEARTBEAT_MS, clock } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function') {
      throw new Error('HubFleetBridge: eventBus with subscribe() required');
    }
    this.#eventBus = eventBus;
    this.#logger = logger || console;
    this.#heartbeatMs = heartbeatMs;
    this.#clock = clock || Date;
  }

  /**
   * Subscribe to hub status snapshots. Idempotent.
   */
  start() {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribe = this.#eventBus.subscribe(
      HUB_STATUS_TOPIC,
      (payload) => this.#handleStatus(payload),
    );
    this.#logger.info?.('playback-hub.fleet-bridge.start', {
      heartbeatMs: this.#heartbeatMs,
    });
  }

  /**
   * Unsubscribe and reset per-lane bookkeeping. Idempotent.
   */
  stop() {
    if (!this.#started) return;
    this.#started = false;
    if (typeof this.#unsubscribe === 'function') {
      try { this.#unsubscribe(); } catch { /* ignore */ }
      this.#unsubscribe = null;
    }
    this.#lanes.clear();
    this.#logger.info?.('playback-hub.fleet-bridge.stop');
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Handle one `playback-hub:status` publish. Never throws.
   * @param {object} payload - `{ type, data: { devices, fetchedAt } }`
   * @private
   */
  #handleStatus(payload) {
    try {
      const devices = payload?.data?.devices;
      if (!Array.isArray(devices)) {
        this.#logger.debug?.('playback-hub.fleet-bridge.skip_malformed', {
          reason: 'devices not an array',
        });
        return;
      }
      const nowMs = this.#clock.now();
      const nowIso = new Date(nowMs).toISOString();
      for (const lane of devices) {
        this.#handleLane(lane, nowMs, nowIso);
      }
    } catch (err) {
      this.#logger.warn?.('playback-hub.fleet-bridge.handle_error', {
        error: err?.message,
      });
    }
  }

  /**
   * @param {object} lane
   * @param {number} nowMs
   * @param {string} nowIso
   * @private
   */
  #handleLane(lane, nowMs, nowIso) {
    let mapped = null;
    try {
      mapped = mapLaneToSnapshot(lane, nowIso);
    } catch (err) {
      this.#logger.debug?.('playback-hub.fleet-bridge.lane_map_error', {
        error: err?.message,
      });
      return;
    }
    if (!mapped) {
      this.#logger.debug?.('playback-hub.fleet-bridge.skip_lane', {
        reason: 'malformed lane entry',
      });
      return;
    }

    const { deviceId, snapshot } = mapped;
    // Fingerprint everything except meta.updatedAt (which changes every tick).
    const fingerprint = JSON.stringify({
      state: snapshot.state,
      currentItem: snapshot.currentItem,
      position: snapshot.position,
      queue: snapshot.queue,
      config: snapshot.config,
    });

    const prev = this.#lanes.get(deviceId);
    let reason = null;
    if (!prev) {
      reason = 'initial';
    } else if (prev.fingerprint !== fingerprint) {
      reason = 'change';
    } else if (nowMs - prev.lastPublishedAt >= this.#heartbeatMs) {
      // Idle lanes heartbeat too: the hub is always-on ambient hardware and
      // must always report — "Not reporting"/offline in the fleet is reserved
      // for gear that is truly dark. (The hub's own status feed going silent
      // still ages lanes out via DeviceLivenessService, which is correct.)
      reason = 'heartbeat';
    }

    if (!reason) return;

    this.#lanes.set(deviceId, {
      fingerprint,
      state: snapshot.state,
      lastPublishedAt: nowMs,
    });

    this.#safeBroadcast(
      DEVICE_STATE_TOPIC(deviceId),
      buildDeviceStateBroadcast({ deviceId, snapshot, reason, ts: nowIso }),
    );
  }

  /**
   * Broadcast defensively — bridge must never take down the status loop.
   * Prefers broadcast() (reaches WS clients + internal subscribers like
   * DeviceLivenessService); falls back to publish().
   * @private
   */
  #safeBroadcast(topic, payload) {
    try {
      if (typeof this.#eventBus.broadcast === 'function') {
        this.#eventBus.broadcast(topic, payload);
      } else if (typeof this.#eventBus.publish === 'function') {
        this.#eventBus.publish(topic, payload);
      }
      this.#logger.debug?.('playback-hub.fleet-bridge.publish', {
        topic,
        reason: payload?.reason,
        state: payload?.snapshot?.state,
      });
    } catch (err) {
      this.#logger.error?.('playback-hub.fleet-bridge.broadcast_error', {
        topic,
        error: err?.message,
      });
    }
  }
}

export default HubFleetBridge;
