/**
 * Reports this surface's play to the household meter.
 *
 * The in-browser emulator knows exactly when it starts, pauses and stops, so it
 * reports its own lifecycle rather than being watched from outside. It emits the
 * SAME observations the inferred source produces and the server folds them with
 * the same use case — the only difference is confidence, which is exact here
 * against a poll interval there.
 *
 * A heartbeat is required for the whole time content remains loaded. Playing
 * heartbeats accrue time between samples; paused heartbeats prove that the
 * session is still deliberately open rather than abandoned by a crashed tab.
 *
 * Reporting is fire-and-forget. A meter that cannot be reached must never
 * interrupt a child's game, so every failure is swallowed after one log.
 */

const DEFAULT_HEARTBEAT_MS = 10_000;
const SURFACE = 'browser-emulator';

export function createArcadeGameSessionReporter({
  deviceId,
  post,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
  getControllers = () => null,
  logger = null,
}) {
  if (!deviceId) throw new Error('createArcadeGameSessionReporter requires deviceId');
  if (typeof post !== 'function') throw new Error('createArcadeGameSessionReporter requires post()');

  let timer = null;
  let current = null;
  let failureReported = false;
  let inFlight = false;
  const queue = [];

  const failed = (error) => {
    if (!failureReported) {
      failureReported = true;
      logger?.warn?.('play.report.failed', { error: error?.message });
    }
  };

  // Preserve lifecycle order across the network. Without this, a slow playing
  // request can arrive after unload and reopen a ghost session on the server.
  const dispatchNext = () => {
    if (inFlight || queue.length === 0) return;
    const body = queue.shift();
    try {
      const result = post(body);
      if (result && typeof result.then === 'function') {
        inFlight = true;
        Promise.resolve(result)
          .then(() => { failureReported = false; }, failed)
          .finally(() => { inFlight = false; dispatchNext(); });
      } else {
        failureReported = false;
        dispatchNext();
      }
    } catch (error) {
      failed(error);
      dispatchNext();
    }
  };

  const send = (state, { loaded = true } = {}) => {
    if (!current) return;
    let controllers = null;
    try {
      const raw = getControllers();
      const count = Number(raw);
      controllers = raw !== null && raw !== undefined && Number.isFinite(count) ? count : null;
    } catch { controllers = null; }
    const body = {
      deviceId,
      surface: SURFACE,
      userId: current.userId ?? null,
      observation: {
        state,
        loaded,
        loadId: current.loadId,
        loadedAt: current.loadedAt,
        observedAt: new Date().toISOString(),
        // Exact: this surface is not being guessed at from outside.
        confidenceMs: 0,
        content: current.content ?? null,
        controllers,
      },
    };
    queue.push(body);
    dispatchNext();
  };

  const stopHeartbeat = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const startHeartbeat = () => {
    stopHeartbeat();
    timer = setTimer(() => {
      if (current) send(current.state);
    }, heartbeatMs);
  };

  return {
    /** A game is on screen and running. */
    started({ userId = null, content = null, loadId = null, loadedAt = null, state = 'playing' } = {}) {
      current = {
        userId, content, loadId,
        loadedAt: loadedAt ?? new Date().toISOString(),
        state,
      };
      send(state);
      startHeartbeat();
    },

    /** Still on screen, not running — a menu, a pause, a lost focus. */
    paused() {
      if (!current) return;
      current.state = 'paused';
      send('paused');
      if (timer === null) startHeartbeat();
    },

    resumed() {
      if (!current) return;
      current.state = 'playing';
      send('playing');
      startHeartbeat();
    },

    updateIdentity(userId) {
      if (!current || !userId) return;
      current.userId = userId;
      send(current.state);
    },

    /**
     * Nothing is loaded any more. `content: null` is what tells the server the
     * session is over rather than merely paused.
     */
    ended() {
      if (!current) return;
      stopHeartbeat();
      send('paused', { loaded: false });
      current = null;
    },

    get isReporting() { return current !== null; },
  };
}

export default createArcadeGameSessionReporter;
