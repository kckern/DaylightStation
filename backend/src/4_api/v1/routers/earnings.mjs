/**
 * `/api/v1/earnings` — what the household's earn rules pay for a week of
 * evidence. READ-ONLY and reusable by any surface (teacher console, fitness,
 * admin): it prices and reports, and writes nothing to any ledger.
 *
 * Changing rates is NOT here. Each surface gates its own write route and
 * calls the same EarnRulesService with the actor it verified — the teacher
 * console's lives under `/api/v1/school/teacher/economy/…` behind the
 * TeacherGate (its capability cookie is scoped to /api/v1/school).
 *
 * Routes:
 *   GET /preview?week=YYYY-MM-DD              → the roster's week
 *   GET /preview/:learnerId?week=YYYY-MM-DD   → one learner's week
 *   GET /rules                                → { ruleset, kinds }
 *
 * `week` is any study day inside the wanted Monday→Sunday week; omitted means
 * the current one. Use cases arrive built (api-no-apps / api-no-domains).
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

export function createEarningsRouter({ earningsPreview, earnRules, logger = console } = {}) {
  if (!earningsPreview?.preview || !earningsPreview?.roster) throw new Error('createEarningsRouter requires earningsPreview');
  if (!earnRules?.describe) throw new Error('createEarningsRouter requires earnRules');
  const router = express.Router();
  const weekOf = (req) => (typeof req.query.week === 'string' && req.query.week ? req.query.week : null);

  router.get('/preview', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await earningsPreview.roster({ week: weekOf(req) }));
  }));

  router.get('/preview/:learnerId', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await earningsPreview.preview({ learnerId: req.params.learnerId, week: weekOf(req) }));
  }));

  router.get('/rules', asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await earnRules.describe());
  }));

  router.use(errorHandlerMiddleware({ shape: 'string', logger }));
  return router;
}

export default createEarningsRouter;
