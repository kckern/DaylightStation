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

import getLogger from '../../../lib/logging/Logger.js';

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
  scroll:   (detail, data) => emit('scroll', detail, data),
  image:    (detail, data) => emit('image', detail, data),
  player:   (detail, data) => emit('player', detail, data),
  dismiss:  (detail, data) => emit('dismiss', detail, data),
  detail:   (detail, data) => emit('detail', detail, data),
  nav:      (detail, data) => emit('nav', detail, data),
  assembly: (detail, data) => emit('assembly', detail, data),
  masonry:  (detail, data) => emit('masonry', detail, data),
};
