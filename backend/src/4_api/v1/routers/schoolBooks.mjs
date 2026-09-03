import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const GRANT_HEADER = 'X-School-Book-Grant';

/**
 * The shelf's routes. Every one is grant-gated and acts for the learner named
 * IN THE GRANT — the URL's learner is only what the grant is checked against,
 * and the body's `learnerId`, if any, is discarded (design §2, review B4/Task 5).
 * Errors are thrown, not translated — the grant refusal included — so the
 * app's error middleware answers every one in its single shape: the stamped
 * 403 for a missing grant, ValidationError as 400, and it owns the 500.
 */
export function createSchoolBooksRouter({ grants, getBookShelf, openBookShelfItem, recordBookProgress } = {}) {
  for (const [name, dep] of Object.entries({ grants, getBookShelf, openBookShelfItem, recordBookProgress })) {
    if (!dep) throw new Error(`createSchoolBooksRouter requires ${name}`);
  }
  const router = express.Router();

  /**
   * The learner this request may act for — the one IN THE GRANT. The URL's
   * learner is only what the grant is checked against. A failed check is
   * thrown, not answered here, so every error on these routes has the ONE
   * shape the app's error handler produces; the status is stamped explicitly
   * because a router may not import the domain's AuthorizationError
   * (api-no-domains) — see errorHandler.mjs's own note on that.
   */
  const learnerFromGrant = (req) => {
    const result = grants.verify(req.get(GRANT_HEADER), { learnerId: req.params.learnerId });
    if (!result?.ok) {
      const error = new Error('A current reading launch is required');
      error.name = 'AuthorizationError';
      error.status = 403;
      throw error;
    }
    return result.payload.learnerId;
  };
  const withoutLearner = (body) => {
    const { learnerId: _ignored, ...rest } = body ?? {};
    return rest;
  };

  router.get('/:learnerId/shelf', asyncHandler(async (req, res) => {
    const learnerId = learnerFromGrant(req);
    res.json(await getBookShelf.execute({ learnerId }));
  }));

  router.post('/:learnerId/shelf', express.json(), asyncHandler(async (req, res) => {
    const learnerId = learnerFromGrant(req);
    res.json(await openBookShelfItem.execute({ ...withoutLearner(req.body), learnerId }));
  }));

  router.post('/:learnerId/shelf/:itemId/progress', express.json(), asyncHandler(async (req, res) => {
    const learnerId = learnerFromGrant(req);
    res.json(await recordBookProgress.execute({ ...withoutLearner(req.body), learnerId, itemId: req.params.itemId }));
  }));

  router.post('/:learnerId/shelf/:itemId/mode', express.json(), asyncHandler(async (req, res) => {
    const learnerId = learnerFromGrant(req);
    res.json(await recordBookProgress.setMode({ learnerId, itemId: req.params.itemId, progressMode: req.body?.progressMode }));
  }));

  return router;
}

export default createSchoolBooksRouter;
