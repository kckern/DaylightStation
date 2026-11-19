import express from 'express';

/** User-scoped triage router. req.triageUsername comes from ?username=, else the default user. */
export function createTriageRouter({ resolvePolicy, defaultUsername, isKnownUser, logger } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const requested = typeof req.query?.username === 'string' && req.query.username ? req.query.username : null;
    const username = requested || (typeof defaultUsername === 'function' ? defaultUsername() : defaultUsername);
    if (!username || !isKnownUser?.(username)) {
      logger?.warn?.('triage.user.unknown', { username: username ?? null });
      return res.status(404).json({ error: `Unknown user: ${username}` });
    }
    req.triageUsername = username;
    next();
  });

  router.get('/status', (req, res) => {
    const policy = resolvePolicy(req.triageUsername);
    res.json({ username: req.triageUsername, enrolled: policy.enrolled, mode: policy.mode });
  });

  return router;
}
