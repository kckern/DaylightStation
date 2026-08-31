import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'player-queue-op-registry' });
  return _logger;
}

/**
 * Arbitrates screen-level play-now/play-next commands across mounted Players.
 *
 * A window CustomEvent is a broadcast: every Player listening to it mutates its
 * own queue. Fullscreen overlays can briefly coexist with a background player,
 * and auxiliary Players are legitimate in a few composite views, so broadcast
 * is never a safe transport. Registrations form a mount-order stack; only the
 * newest live Player receives a command, and removing it restores the prior
 * owner without letting a stale unregister clobber a newer one.
 */
export function createPlayerQueueOpRegistry() {
  let nextToken = 0;
  const entries = [];

  return {
    register(handler) {
      if (typeof handler !== 'function') return () => {};
      const entry = { token: ++nextToken, handler };
      entries.push(entry);

      return () => {
        const index = entries.findIndex(({ token }) => token === entry.token);
        if (index >= 0) entries.splice(index, 1);
      };
    },

    dispatch(payload) {
      const current = entries.at(-1);
      if (!current) return false;
      try {
        const result = current.handler(payload);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => logger().warn('player.queue-op.handler-failed', {
            op: payload?.op,
            contentId: payload?.contentId,
            error: err?.message ?? String(err),
          }));
        }
      } catch (err) {
        logger().warn('player.queue-op.handler-failed', {
          op: payload?.op,
          contentId: payload?.contentId,
          error: err?.message ?? String(err),
        });
      }
      return true;
    },
  };
}

let _singleton = null;

export function getPlayerQueueOpRegistry() {
  if (!_singleton) _singleton = createPlayerQueueOpRegistry();
  return _singleton;
}

export function __resetPlayerQueueOpRegistryForTests() {
  _singleton = null;
}

export default getPlayerQueueOpRegistry;
