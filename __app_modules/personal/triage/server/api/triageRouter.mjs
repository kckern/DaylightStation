import express from 'express';
export { requireOwnerSession } from './requireOwnerSession.mjs';

/** User-scoped triage router. req.triageUsername comes from ?username=, else the logged-in user, else the default user. */
export function createTriageRouter({ resolvePolicy, defaultUsername, isKnownUser, logger } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const requested = typeof req.query?.username === 'string' && req.query.username ? req.query.username : null;
    const username = requested || req.user?.sub || (typeof defaultUsername === 'function' ? defaultUsername() : defaultUsername);
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
