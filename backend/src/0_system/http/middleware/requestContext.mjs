/**
 * withRequestContext — run a router (or any handler) inside a request
 * context holding the caller's User-Agent and `X-Daylight-Device` header
 * (see #system/runtime/requestContext.mjs).
 *
 * Wraps rather than `app.use`s so only the routers that need it pay for it.
 * Mount after the body parsers (a parser finishes outside any context).
 */
import { runWithRequestContext } from '../../runtime/requestContext.mjs';

const header = (req, name) => {
  const value = typeof req.get === 'function' ? req.get(name) : req.headers?.[name.toLowerCase()];
  return typeof value === 'string' && value ? value.slice(0, 256) : null;
};

/**
 * @param {Function} handler - express router / middleware
 * @returns {Function}
 */
export function withRequestContext(handler) {
  return function requestContextHandler(req, res, next) {
    return runWithRequestContext(
      { userAgent: header(req, 'User-Agent'), device: header(req, 'X-Daylight-Device') },
      () => handler(req, res, next),
    );
  };
}

export default withRequestContext;
