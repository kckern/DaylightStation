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
 * Categories: scroll, image, player, dismiss, detail, nav, assembly,
 *             masonry, viewport, timing, interaction, session, resolution,
 *             perf
 */

import getLogger from '../../../lib/logging/Logger.js';

// Re-create child each call so it picks up the current root context
// (sessionLog: true is set via configureLogger after first import).
function logger() {
  return getLogger().child({ component: 'feed-scroll' });
}

function emit(category, detail, data, level = 'debug') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  if (typeof data === 'string') payload.info = data;
  payload.detail = detail;
  logger()[level](`feed-${category}`, payload);
}

export const feedLog = {
  scroll:   (detail, data) => emit('scroll', detail, data),
  image:    (detail, data) => emit('image', detail, data),
  player:   (detail, data) => emit('player', detail, data, 'info'),
  dismiss:  (detail, data) => emit('dismiss', detail, data, 'info'),
  detail:   (detail, data) => emit('detail', detail, data, 'info'),
  nav:      (detail, data) => emit('nav', detail, data, 'info'),
  assembly: (detail, data) => emit('assembly', detail, data),
  masonry:  (detail, data) => emit('masonry', detail, data),
  viewport:    (detail, data) => emit('viewport', detail, data),
  timing:      (detail, data) => emit('timing', detail, data),
  interaction: (detail, data) => emit('interaction', detail, data, 'info'),
  session:     (detail, data) => emit('session', detail, data),
  resolution:  (detail, data) => emit('resolution', detail, data, 'info'),
  perf:        (detail, data) => emit('perf', detail, data),
};
