// frontend/src/screen-framework/publishers/playerSessionRegistry.js
//
// playerSessionRegistry — the seam between "a legacy Player is mounted
// somewhere on this screen" and the session-state publishers.
//
// The legacy Player (modules/Player) mounts through two independent paths on
// screen-framework screens (ScreenActionHandler overlays and the MenuStack
// nav stack); neither can reach the renderer-level <SessionStatePublisher>.
// Instead, whichever mount point currently hosts a live Player registers a
// small adapter here, and `createRegistrySessionSource` (SessionSourceContext)
// reads whatever is registered — falling back to idle when nothing is.
//
// Semantics:
//   - registerPlayerSession(entry) — last-write-wins; returns an unregister
//     function. A stale unregister (called after another registration replaced
//     it) is a no-op, so unmount races can't clobber a newer player.
//   - getCurrent() — the active registration or null.
//   - subscribe(fn) — notified (with the current registration) on every
//     register/unregister. Listener errors are swallowed: a broken consumer
//     must never break the screen.
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'playerSessionRegistry' });
  return _logger;
}

export function createPlayerSessionRegistry() {
  let current = null; // { player, queueController, item, token }
  let tokenCounter = 0;
  const listeners = new Set();

  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn(current);
      } catch (err) {
        logger().warn('listener-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  return {
    /**
     * Register the currently-playing player. Last write wins.
     * @param {object} entry
     * @param {object} [entry.player]          — {getState,getPosition,getDuration,getConfig,subscribe}
     * @param {object} [entry.queueController] — {getQueue,getCurrentItem,getCurrentIndex,subscribe}
     * @param {object} [entry.item]            — static PlayableItem fallback when no queueController
     * @returns {function} unregister
     */
    registerPlayerSession(entry = {}) {
      const token = ++tokenCounter;
      current = {
        player: entry.player ?? null,
        queueController: entry.queueController ?? null,
        item: entry.item ?? null,
        token,
      };
      logger().info('registered', { token });
      notify();
      return () => {
        if (current?.token !== token) return; // superseded — no-op
        current = null;
        logger().info('unregistered', { token });
        notify();
      };
    },

    getCurrent: () => current,

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Module singleton (one registry per screen tab, like getActionBus).
let _singleton = null;

export function getPlayerSessionRegistry() {
  if (!_singleton) _singleton = createPlayerSessionRegistry();
  return _singleton;
}

/** Test-only: drop the singleton so each test gets a fresh registry. */
export function __resetPlayerSessionRegistryForTests() {
  _singleton = null;
}

export default getPlayerSessionRegistry;
