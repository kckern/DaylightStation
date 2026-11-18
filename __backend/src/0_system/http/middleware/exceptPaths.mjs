/**
 * Keep app-wide middleware off the few routes that guard themselves.
 *
 * App-wide middleware runs before any router. For most routes that is the
 * point. A route that must refuse a request from its headers alone, before a
 * byte of the body is read, or that must not answer a cross-origin preflight,
 * cannot do either once an app-wide body parser or CORS handler has already
 * run. `exceptPaths` wraps such middleware so it steps aside for the listed
 * paths and behaves exactly as before everywhere else.
 *
 * Paths are compared the way the Express router matches them by default:
 * without regard to case or a trailing slash, and without the query string.
 *
 * @param {string[]} paths - Full request paths, e.g. '/api/v1/journalist/memo'
 * @returns {(middleware: import('express').RequestHandler) => import('express').RequestHandler}
 */
export function exceptPaths(paths = []) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/\/+$/, '') || '/';
  const excepted = new Set(paths.map(normalize));

  return (middleware) => (req, res, next) => {
    if (excepted.has(normalize(req.path))) return next();
    return middleware(req, res, next);
  };
}

export default exceptPaths;
