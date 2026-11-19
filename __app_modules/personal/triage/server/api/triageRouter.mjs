import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';
import { requireOwnerSession } from './requireOwnerSession.mjs';
export { requireOwnerSession };

/** User-scoped triage router. req.triageUsername comes from ?username=, else the logged-in user, else the default user. */
export function createTriageRouter({ resolvePolicy, defaultUsername, isKnownUser, runPass = null, logger } = {}) {
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

  // On-demand pass. A write (it may archive mail or close tasks), so it needs the user's login session.
  router.post('/run', requireOwnerSession, async (req, res) => {
    if (typeof runPass !== 'function') return res.status(503).json({ error: 'triage_unavailable' });
    try {
      res.json(await runPass({ username: req.triageUsername, trigger: 'manual' }));
    } catch (err) {
      logger?.error?.('triage.run.failed', { username: req.triageUsername, error: err?.message });
      sendInternalError(res, { error: 'triage_pass_failed' });
    }
  });

  return router;
}
