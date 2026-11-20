import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

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
 * A registration's onDeactivate callback retires work from that foreground visit.
 * An optional payload.onResult observes the handler's settled return value;
 * dispatch's boolean still reports only owner presence. Retry uses the result
 * to acknowledge guarded admission instead of optimistic command receipt.
 */
export function createPlayerQueueOpRegistry() {
  const entries = [];

  return {
    register(handler, onDeactivate) {
      if (typeof handler !== 'function') return () => {};
      const previous = entries.at(-1);
      const entry = { handler, onDeactivate };
      entries.push(entry);
      previous?.onDeactivate?.();

      return () => {
        const index = entries.indexOf(entry);
        if (index < 0) return;
        const wasForeground = index === entries.length - 1;
        entries.splice(index, 1);
        if (wasForeground) entry.onDeactivate?.();
      };
    },

    dispatch(payload) {
      const current = entries.at(-1);
      if (!current) return false;
      try {
        const result = current.handler(payload);
        if (typeof payload?.onResult === 'function') {
          Promise.resolve(result).then(payload.onResult, error => payload.onResult({ ok: false, code: 'PLAYBACK_OWNER_ERROR', error: error?.message ?? String(error) }));
        } else if (result && typeof result.catch === 'function') {
          result.catch((err) => logger().warn('player.queue-op.handler-failed', {
            op: payload?.op,
            contentId: payload?.contentId,
            error: err?.message ?? String(err),
          }));
        }
      } catch (err) {
        payload?.onResult?.({ ok: false, code: 'PLAYBACK_OWNER_ERROR', error: err?.message ?? String(err) });
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
