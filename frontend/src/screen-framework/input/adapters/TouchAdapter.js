import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'TouchAdapter' });
  return _logger;
}

/**
 * TouchAdapter intentionally does not register key listeners.
 * Touchscreens interact directly with clickable UI elements.
 */
export class TouchAdapter {
  constructor() {
    this.attached = false;
  }

  attach() {
    this.attached = true;
    logger().info('touch.attach', {});
  }

  destroy() {
    this.attached = false;
    logger().debug('touch.destroy', {});
  }

  isHealthy() {
    return this.attached;
  }
}