import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';
import { requireOwnerSession } from './requireOwnerSession.mjs';
export { requireOwnerSession };

const ERROR_STATUS = {
  TRIAGE_CARD_NOT_FOUND: [404, 'card_not_found'], TRIAGE_CARD_NOT_OPEN: [409, 'card_not_open'],
  TRIAGE_INVALID_ANSWER: [400, 'invalid_answer'], TRIAGE_ANSWER_IN_DOUBT: [409, 'answer_in_doubt'],
};
const requestId = () => `req.${globalThis.crypto.randomUUID()}`;

/**
 * User-scoped triage router. req.triageUsername comes from ?username=, else the logged-in user, else the default user.
 * Routes that show email/task content (/session, /log) and every write need the user's login session;
 * /status and /summary (counts only) are open. `session` is the wired TriageSession service.
 */
export function createTriageRouter({ resolvePolicy, defaultUsername, isKnownUser, runPass = null, session = null, logger } = {}) {
  const router = express.Router();
  const json = express.json({ limit: '64kb' });

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

  const needSession = (req, res, next) => (session ? next() : res.status(503).json({ error: 'triage_unavailable' }));
  const handle = (name, fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      // An answer that waited too long for the user's lock (normally a running pass).
      if (err?.code === 'TRIAGE_BUSY') return res.status(409).json({ error: err.holder === 'answer' ? 'busy' : 'pass_running' });
      const mapped = ERROR_STATUS[err?.code];
      if (mapped) return res.status(mapped[0]).json({ error: mapped[1], ...(err.status ? { status: err.status } : {}) });
      logger?.error?.(`triage.${name}.failed`, { username: req.triageUsername, error: err?.message, code: err?.code ?? null });
      return sendInternalError(res, { error: `triage_${name}_failed` });
    }
  };
  const auth = (req) => ({ session: req.triageSession, requestId: requestId() });

  router.get('/summary', needSession, handle('summary', (req) => session.summary({ username: req.triageUsername })));
  router.get('/session', requireOwnerSession, needSession, handle('session', (req) => session.session({ username: req.triageUsername })));
  router.post('/cards/:cardId/answer', requireOwnerSession, needSession, json, handle('answer', (req) => {
    const { choice, text, draft } = req.body ?? {};
    return session.answer({
      username: req.triageUsername, cardId: req.params.cardId, auth: auth(req),
      choice: typeof choice === 'string' && choice ? choice : undefined,
      text: typeof text === 'string' ? text : undefined,
      draft: draft && typeof draft === 'object' ? { body: draft.body } : undefined,
    });
  }));
  router.post('/cards/:cardId/skip', requireOwnerSession, needSession, handle('skip',
    (req) => session.skip({ username: req.triageUsername, cardId: req.params.cardId })));
  router.get('/log', requireOwnerSession, needSession, handle('log', (req) => {
    const n = Number.parseInt(req.query?.sinceDays, 10);
    return session.log({ username: req.triageUsername, sinceDays: Number.isFinite(n) ? n : 7 });
  }));
  router.post('/log/:entryId/undo', requireOwnerSession, needSession, handle('undo',
    (req) => session.undo({ username: req.triageUsername, entryId: req.params.entryId, auth: auth(req) })));

  return router;
}
