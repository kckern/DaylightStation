// frontend/src/modules/Auto/autoLog.js
//
// Category facade over the structured logger for the Auto app, following the
// pattern in modules/Feed/Scroll/feedLog.js. Lazy-initialised so importing this
// module never races the logger's own configuration at startup.

import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'auto' });
  return _logger;
}

export const autoLog = {
  debug: (event, data) => logger().debug(event, data),
  info: (event, data) => logger().info(event, data),
  warn: (event, data) => logger().warn(event, data),
  error: (event, data) => logger().error(event, data),
};

export default autoLog;
