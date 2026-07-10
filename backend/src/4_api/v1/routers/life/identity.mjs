/**
 * Username resolution for life routers.
 * Resolves from the query param, falls back to the configured default user
 * (head of household at the composition root), and validates against known
 * profiles when a userService is provided.
 */
export function createUsernameResolver({ userService, defaultUsername } = {}) {
  const fallback = defaultUsername || 'default';

  const resolve = (req) => req.query?.username || fallback;

  const isKnown = (username) => {
    if (!userService?.getProfile) return true; // no user directory available — accept as before
    return !!userService.getProfile(username);
  };

  /**
   * Express middleware: resolves req.lifeUsername from the query (or default)
   * and rejects unknown users with 404.
   */
  const middleware = (req, res, next) => {
    const username = resolve(req);
    if (!isKnown(username)) {
      return res.status(404).json({ error: `Unknown user: ${username}` });
    }
    req.lifeUsername = username;
    next();
  };

  return { resolve, isKnown, middleware };
}
