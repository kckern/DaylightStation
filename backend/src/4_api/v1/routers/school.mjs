/**
 * /api/v1/school — thin HTTP shell over SchoolService (spec §5, §8).
 * All policy lives in the service; this file only maps errors to statuses.
 */
import express from 'express';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export function createSchoolRouter({ schoolService, logger = console }) {
  const router = express.Router();
  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (err instanceof SessionGoneError) return res.status(410).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
        logger.error?.('school.router.error', { path: req.path, error: err.message });
        return res.status(500).json({ error: 'internal' });
      });
  };

  router.get('/roster', wrap((req, res) => res.json(schoolService.getRoster())));
  router.get('/banks', wrap((req, res) => res.json(schoolService.listBanks({ audience: req.query.audience }))));
  router.get('/banks/:bankId', wrap((req, res) => res.json(schoolService.getBank(req.params.bankId))));
  router.post('/sessions', wrap((req, res) => {
    const { userId = null, bankId, mode } = req.body || {};
    res.json(schoolService.openSession({ userId, bankId, mode }));
  }));
  router.post('/sessions/:sessionId/answer', wrap((req, res) => {
    const { itemId, given, selfGrade } = req.body || {};
    res.json(schoolService.answer({ sessionId: req.params.sessionId, itemId, given, selfGrade }));
  }));
  router.get('/users/:userId/results', wrap((req, res) => {
    res.json(schoolService.getResults(req.params.userId, { bankId: req.query.bankId }));
  }));
  return router;
}

export default createSchoolRouter;
