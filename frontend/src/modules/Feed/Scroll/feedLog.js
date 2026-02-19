/**
 * Feed scroll diagnostic logger.
 *
 * Uses the DaylightStation logging framework with a child logger
 * scoped to the feed-scroll component. Events are emitted at debug
 * level with structured data and routed through all configured
 * transports (console, WebSocket).
 *
 * Enable debug output:  window.DAYLIGHT_LOG_LEVEL = 'debug'
 *                    or configure({ level: 'debug' })
 *
 * Categories: scroll, image, player, dismiss, detail, nav
 */

<<<<<<< Updated upstream
const CATEGORIES = ['scroll', 'image', 'player', 'dismiss', 'detail', 'nav', 'assembly', 'masonry'];
=======
import getLogger from '../../../lib/logging/Logger.js';
>>>>>>> Stashed changes

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'feed-scroll' });
  return _logger;
}

function emit(category, detail, data) {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  if (typeof data === 'string') payload.info = data;
  payload.detail = detail;
  logger().debug(`feed-${category}`, payload);
}

export const feedLog = {
<<<<<<< Updated upstream
  scroll:   (...args) => log('scroll', ...args),
  image:    (...args) => log('image', ...args),
  player:   (...args) => log('player', ...args),
  dismiss:  (...args) => log('dismiss', ...args),
  detail:   (...args) => log('detail', ...args),
  nav:      (...args) => log('nav', ...args),
  assembly: (...args) => log('assembly', ...args),
  masonry:  (...args) => log('masonry', ...args),
=======
  scroll:  (detail, data) => emit('scroll', detail, data),
  image:   (detail, data) => emit('image', detail, data),
  player:  (detail, data) => emit('player', detail, data),
  dismiss: (detail, data) => emit('dismiss', detail, data),
  detail:  (detail, data) => emit('detail', detail, data),
  nav:     (detail, data) => emit('nav', detail, data),
>>>>>>> Stashed changes
};
