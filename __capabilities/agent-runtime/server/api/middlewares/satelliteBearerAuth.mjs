/**
 * Express middleware factory for OpenAI-compatible Bearer token auth.
 *
 * Resolves the Authorization header token against ISatelliteRegistry.
 * On success, attaches the satellite object to req.satellite and calls next().
 * On failure, responds 401 with an OpenAI-shaped error body.
 *
 * @param {Object} opts
 * @param {Object} opts.satelliteRegistry  - must expose findByToken(token) → satellite | null
 * @param {Object} [opts.logger]           - structured logger (warn/info); defaults to console
 * @returns {Function} Express middleware (async)
 */
export function satelliteBearerAuth({ satelliteRegistry, logger = console } = {}) {
  if (!satelliteRegistry?.findByToken) {
    throw new Error('satelliteBearerAuth: satelliteRegistry.findByToken required');
  }

  return async function bearerAuth(req, res, next) {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      logger.warn?.('agents.openai.auth.failed', { code: 'missing_token', ip: req.ip });
      return res.status(401).json({ error: { message: 'missing_token', type: 'auth', code: 'missing_token' } });
    }
    const token = auth.slice(7).trim();
    const satellite = await satelliteRegistry.findByToken(token);
    if (!satellite) {
      logger.warn?.('agents.openai.auth.failed', { code: 'invalid_token', ip: req.ip, token_prefix: token.slice(0, 6) });
      return res.status(401).json({ error: { message: 'invalid_token', type: 'auth', code: 'invalid_token' } });
    }
    req.satellite = satellite;
    next();
  };
}

export default satelliteBearerAuth;
