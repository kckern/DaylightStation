// The lazy module-logger boilerplate (repeated ~5x across apps), once.
// Lazy so import-time logger configuration races are impossible.
import getLogger from '../logging/Logger.js';

export function createAppLogger(app) {
  let _logger;
  const base = () => {
    if (!_logger) _logger = getLogger().child({ app });
    return _logger;
  };
  const facade = (get) => ({
    debug: (e, d) => get().debug(e, d),
    info:  (e, d) => get().info(e, d),
    warn:  (e, d) => get().warn(e, d),
    error: (e, d) => get().error(e, d),
    sampled: (e, d, o) => get().sampled(e, d, o),
    child: (component) => {
      let _child;
      return facade(() => {
        if (!_child) _child = get().child({ component });
        return _child;
      });
    },
  });
  return facade(base);
}

export default createAppLogger;
