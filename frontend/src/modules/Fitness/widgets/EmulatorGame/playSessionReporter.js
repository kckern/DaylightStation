/**
 * Reports this surface's play to the household meter.
 *
 * The in-browser emulator knows exactly when it starts, pauses and stops, so it
 * reports its own lifecycle rather than being watched from outside. It emits the
 * SAME observations the inferred source produces and the server folds them with
 * the same use case — the only difference is confidence, which is exact here
 * against a poll interval there.
 *
 * A heartbeat is still required while playing. Played time accrues between
 * consecutive observations that both saw play, so a session that announced
 * "playing" once and then went silent would accrue nothing at all.
 *
 * Reporting is fire-and-forget. A meter that cannot be reached must never
 * interrupt a child's game, so every failure is swallowed after one log.
 */

const DEFAULT_HEARTBEAT_MS = 10_000;
const SURFACE = 'browser-emulator';

export function createPlaySessionReporter({
  deviceId,
  post,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
  logger = null,
}) {
  if (!deviceId) throw new Error('createPlaySessionReporter requires deviceId');
  if (typeof post !== 'function') throw new Error('createPlaySessionReporter requires post()');

  let timer = null;
  let current = null;

  const send = (state, content, userId) => {
    const body = {
      deviceId,
      surface: SURFACE,
      userId: userId ?? null,
      observation: {
        state,
        observedAt: new Date().toISOString(),
        // Exact: this surface is not being guessed at from outside.
        confidenceMs: 0,
        content: content ?? null,
      },
    };
    try {
      const result = post(body);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => logger?.debug?.('play.report.failed', { error: error?.message }));
      }
    } catch (error) {
      logger?.debug?.('play.report.failed', { error: error?.message });
    }
  };

  const stopHeartbeat = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  return {
    /** A game is on screen and running. */
    started({ userId = null, content = null } = {}) {
      current = { userId, content };
      send('playing', content, userId);
      stopHeartbeat();
      timer = setTimer(() => {
        if (current) send('playing', current.content, current.userId);
      }, heartbeatMs);
    },

    /** Still on screen, not running — a menu, a pause, a lost focus. */
    paused() {
      if (!current) return;
      stopHeartbeat();
      send('paused', current.content, current.userId);
    },

    /**
     * Nothing is loaded any more. `content: null` is what tells the server the
     * session is over rather than merely paused.
     */
    ended() {
      if (!current) return;
      const { userId } = current;
      stopHeartbeat();
      send('paused', null, userId);
      current = null;
    },

    get isReporting() { return current !== null; },
  };
}

export default createPlaySessionReporter;
