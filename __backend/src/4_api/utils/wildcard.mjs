/**
 * Wildcard-param helper for Express 5 routes.
 *
 * Express 5 (router@2 / path-to-regexp@8) replaced Express 4's bare `*`
 * wildcard with named wildcards (`/*splat`), and exposes the match as an
 * ARRAY of path segments instead of Express 4's single `req.params[0]`
 * string. This helper reconstructs the Express-4-style "rest of path"
 * string that our handlers were written against.
 *
 * Decoding note: path-to-regexp v8 decodes each segment before it reaches
 * req.params, so callers must NOT run decodeURIComponent() on the result —
 * that would double-decode paths containing literal `%` characters.
 *
 * @param {import('express').Request} req
 * @param {string} [name='splat'] - Wildcard parameter name
 * @returns {string} Joined path (empty string when the wildcard is absent)
 */
export function splatPath(req, name = 'splat') {
  const value = req.params?.[name];
  if (Array.isArray(value)) return value.join('/');
  return value ?? '';
}

export default splatPath;
