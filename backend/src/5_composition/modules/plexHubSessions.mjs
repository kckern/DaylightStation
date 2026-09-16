/**
 * playback-hub -> Plex sessions.
 *
 * The hub is headless: nothing mounts the Player, so no `play/log` heartbeat
 * ever arrives and music played to the speakers appeared nowhere on the Plex
 * dashboard. It does, however, publish a full lane snapshot every ~3s, which
 * carries everything a session needs.
 *
 * This lives in composition ON PURPOSE. `playback-hub` must not know Plex
 * exists and `content` must not know the hub exists; wiring two bounded
 * contexts together is composition's job, and per the DDD reference it is
 * "the only sanctioned cross-layer zone". Putting this call inside
 * HubFleetBridge would have made an application layer import an adapter.
 *
 * It subscribes to the same `playback-hub:status` topic HubFleetBridge uses and
 * reuses its exported pure `mapLaneToSnapshot`, so the lane -> session mapping
 * is defined once.
 *
 * KNOWN GAP: a paused lane is reported as a heartbeat at its true position, so
 * the session stays alive and correctly placed, but Plex renders it as playing
 * — `ReportPlaybackSession.execute` carries no paused state yet.
 *
 * @module 5_composition/modules/plexHubSessions
 */

import { mapLaneToSnapshot } from '#apps/playback-hub/runtime/HubFleetBridge.mjs';

const HUB_STATUS_TOPIC = 'playback-hub:status';

/**
 * Speaker lanes are declared devices, so they address the registry the same way
 * a screen does and resolve to their own declared `plex:` identity. Without the
 * prefix all five speakers would collapse onto one shared web identity and
 * their sessions would overwrite each other.
 */
const FLEET_PREFIX = 'fleet:';

/** The media server only owns content it minted; a lane playing anything else
 * (or the `playback-hub:<color>` fallback ref) is not its business. */
const PLEX_CONTENT_PREFIX = 'plex:';

const SECONDS_TO_MS = 1000;

/** @type {{ stop: Function } | null} */
let instance = null;

/**
 * Bridge hub lane status into Plex playback sessions.
 *
 * @param {object} config
 * @param {object} config.eventBus
 * @param {object|null} config.reportPlaybackSession - absent when no media server is configured
 * @param {object} [config.logger]
 * @param {{now: () => number}} [config.clock]
 * @returns {{ plexHubSessions: { stop: Function } | null }}
 */
export function createPlexHubSessions(config) {
  const { eventBus, reportPlaybackSession, logger = console, clock = Date } = config || {};

  if (!eventBus?.subscribe) throw new Error('createPlexHubSessions requires eventBus');

  // No media server configured — the hub still runs, it just reports nowhere.
  if (!reportPlaybackSession) return { plexHubSessions: null };

  if (instance) {
    logger.warn?.('plex-hub-sessions.already_created');
    return { plexHubSessions: instance };
  }

  // SERIAL, like the broadcaster that feeds it: a tick is dropped rather than
  // overlapped, so a slow media server cannot pile up requests every 3s.
  let inFlight = false;

  async function reportLane(lane, nowMs, nowIso) {
    let mapped = null;
    try {
      mapped = mapLaneToSnapshot(lane, nowIso);
    } catch {
      return; // a malformed lane is the bridge's problem, not the hub's
    }
    if (!mapped) return;

    const { deviceId, snapshot } = mapped;
    const surfaceId = `${FLEET_PREFIX}${deviceId}`;

    if (snapshot.state === 'idle') {
      // Stopped, NOT finished — the hub never signals a natural end, so this
      // must never mark the track watched.
      await reportPlaybackSession.stop({ surfaceId, at: nowMs });
      return;
    }

    const contentId = snapshot.currentItem?.contentId;
    if (typeof contentId !== 'string' || !contentId.startsWith(PLEX_CONTENT_PREFIX)) return;

    const durationSeconds = Number(snapshot.currentItem?.duration);
    await reportPlaybackSession.execute({
      surfaceId,
      contentId,
      // Contract units are seconds on both; the session speaks milliseconds.
      positionMs: Math.round((Number(snapshot.position) || 0) * SECONDS_TO_MS),
      durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.round(durationSeconds * SECONDS_TO_MS)
        : 0,
      // The hub cannot distinguish finishing from being skipped, and only a
      // natural end may be written to watch history.
      completed: false,
      at: nowMs,
    });
  }

  async function handleStatus(status) {
    const devices = status?.devices;
    if (!Array.isArray(devices) || inFlight) return;
    inFlight = true;
    const nowMs = clock.now();
    const nowIso = new Date(nowMs).toISOString();
    try {
      for (const lane of devices) {
        await reportLane(lane, nowMs, nowIso);
      }
    } catch (error) {
      // Reporting is advisory. A media server that is down must never stop the
      // music or break the hub's own status loop.
      logger.warn?.('plex-hub-sessions.report_failed', { error: error?.message });
    } finally {
      inFlight = false;
    }
  }

  const unsubscribe = eventBus.subscribe(HUB_STATUS_TOPIC, (payload) => {
    handleStatus(payload?.data);
  });

  instance = {
    stop() {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
        else eventBus.unsubscribe?.(HUB_STATUS_TOPIC, handleStatus);
      } catch {
        // shutdown is best-effort
      }
    },
  };

  logger.info?.('plex-hub-sessions.started');
  return { plexHubSessions: instance };
}

/** @returns {{stop: Function}|null} */
export function getPlexHubSessions() {
  return instance;
}

/** Stop and tear down. Safe during shutdown or test cleanup. */
export function stopPlexHubSessions() {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

export default createPlexHubSessions;
