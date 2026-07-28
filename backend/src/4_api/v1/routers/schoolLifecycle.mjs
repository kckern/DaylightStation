/**
 * /api/v1/school/lifecycle — HTTP over the physical console (spec §5–§9).
 *
 * A thin shell, like every other router here: it reads the request, calls one
 * use case, and returns what came back. All policy — who may do what, when a
 * ticket is still valid, what prints — lives in the use cases.
 *
 * TWO BOUNDARY RULES, both structural rather than stylistic:
 *
 *  - **Errors are mapped HERE, not imported.** `4_api` may not import
 *    `#domains/*` (`api-no-domains`), so nothing in this file knows a domain
 *    error class. The use cases already return a `status` string for every
 *    outcome they model, and that string maps to an HTTP status through one
 *    table below. Genuine exceptions go to `errorHandlerMiddleware`.
 *  - **No `success: false` envelope and no hand-rolled 500.** A refusal is a
 *    real HTTP status with the use case's own child-facing message attached,
 *    because that message is the thing a parent surface should display.
 *
 * Every route is registered only when its use case is actually injected, so a
 * deployment with the lifecycle unwired 404s rather than half-answering.
 *
 * @module api/v1/routers/schoolLifecycle
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Use-case outcome → HTTP status. Anything not listed is a success (200): the
 * use cases model refusals explicitly, so an unlisted status is one that means
 * "this worked".
 */
const STATUS_BY_OUTCOME = Object.freeze({
  unavailable: 404,
  unknown: 404,
  unknown_learner: 404,
  unknown_session: 404,
  not_school: 400,
  expired: 410,
  duplicate: 409,
  already_done: 409,
  already_settled: 409,
  already_opened: 409,
  already_playing: 409,
  already_completed: 409,
  not_playing: 409,
  // The printer is a device this route talks through, so its silence is a
  // gateway failure. A document that could not be DRAWN is not — the request
  // named content this server cannot turn into a sheet, which is 422, and
  // reporting it as 502 would send an operator to the printer.
  print_failed: 502,
  render_failed: 422,
  uncorrelated: 204,
});

const httpStatusFor = (outcome) => STATUS_BY_OUTCOME[outcome] ?? 200;

/** Send a use-case result at the status its own outcome implies. */
function reply(res, result) {
  const status = httpStatusFor(result?.status);
  if (status === 204) return res.status(204).end();
  return res.status(status).json(result);
}

/**
 * @param {object} deps - each use case is optional and gates its own routes
 * @param {object} [deps.resolveScanAction]
 * @param {object} [deps.buildAgenda]
 * @param {object} [deps.issueDocument]
 * @param {object} [deps.dispatchMedia]
 * @param {object} [deps.recordMediaCompletion]
 * @param {object} [deps.submitPaperWork]
 * @param {object} [deps.gradeSubmission]
 * @param {object} [deps.closeSessionOutcome]
 * @param {object} [deps.openRemediation]
 * @param {object} [deps.assignments] - IAssignmentStore, for the parent surface
 * @param {object} [deps.reviewQueue] - IReviewQueue, for the parent surface
 * @param {object} [deps.sessions] - IWorkSessionRepository, for session history
 * @param {() => Date} [deps.clock]
 * @param {object} [deps.logger]
 * @returns {import('express').Router}
 */
export function createSchoolLifecycleRouter({
  resolveScanAction = null,
  buildAgenda = null,
  issueDocument = null,
  dispatchMedia = null,
  recordMediaCompletion = null,
  submitPaperWork = null,
  gradeSubmission = null,
  closeSessionOutcome = null,
  openRemediation = null,
  assignments = null,
  reviewQueue = null,
  sessions = null,
  clock = () => new Date(),
  logger = console,
} = {}) {
  const router = express.Router();

  const wired = Object.entries({
    resolveScanAction, buildAgenda, issueDocument, dispatchMedia, recordMediaCompletion,
    submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation,
  }).filter(([, v]) => v).map(([k]) => k);
  if (!wired.length) {
    logger.warn?.('school.lifecycle.not-wired', {});
    return router;
  }
  logger.info?.('school.lifecycle.mounted', { useCases: wired });

  // --- the scan ingress, over HTTP ------------------------------------------
  // The relay branch calls the use case directly; this is the same door for a
  // keyed-in code, a test, or a scanner that speaks HTTP.
  if (resolveScanAction) {
    router.post('/scan', asyncHandler(async (req, res) => {
      const { code, device = null } = req.body || {};
      reply(res, await resolveScanAction.execute({ code, device }));
    }));
  }

  // --- agenda ---------------------------------------------------------------
  if (buildAgenda) {
    router.get('/learners/:learnerId/agenda', asyncHandler(async (req, res) => {
      const result = await buildAgenda.execute({
        learnerId: req.params.learnerId,
        learnerName: typeof req.query.name === 'string' ? req.query.name : null,
      });
      res.json(result);
    }));
  }

  // --- sessions -------------------------------------------------------------
  if (sessions) {
    router.get('/learners/:learnerId/sessions', asyncHandler(async (req, res) => {
      res.json({ sessions: await sessions.listForLearner(req.params.learnerId) });
    }));

    router.get('/sessions/:sessionId/events', asyncHandler(async (req, res) => {
      res.json({ events: await sessions.readEvents(req.params.sessionId) });
    }));
  }

  if (issueDocument) {
    router.post('/sessions/:sessionId/issue', asyncHandler(async (req, res) => {
      reply(res, await issueDocument.execute({ sessionId: req.params.sessionId }));
    }));
  }

  if (dispatchMedia) {
    router.get('/media/targets', asyncHandler(async (_req, res) => {
      res.json({ targets: dispatchMedia.selectableTargets() });
    }));

    router.post('/sessions/:sessionId/media/dispatch', asyncHandler(async (req, res) => {
      const { target = null } = req.body || {};
      reply(res, await dispatchMedia.execute({ sessionId: req.params.sessionId, target }));
    }));
  }

  if (recordMediaCompletion) {
    router.post('/media/complete', asyncHandler(async (req, res) => {
      const { sessionId = null, learnerId = null, dispatchId = null, verified = 'playhead' } = req.body || {};
      reply(res, await recordMediaCompletion.execute({ sessionId, learnerId, dispatchId, verified }));
    }));

    router.post('/sessions/:sessionId/media/check-stalled', asyncHandler(async (req, res) => {
      const { graceSec = null } = req.body || {};
      res.json(await recordMediaCompletion.checkStalled({ sessionId: req.params.sessionId, graceSec }));
    }));
  }

  // --- submission and grading ------------------------------------------------
  if (submitPaperWork) {
    router.post('/sessions/:sessionId/submit', asyncHandler(async (req, res) => {
      const { entries = {}, ambiguous = [], blank = [], submittedBy = null, sheet = null } = req.body || {};
      const result = sheet
        ? await submitPaperWork.fromOmrSheet({ sessionId: req.params.sessionId, sheet, submittedBy })
        : await submitPaperWork.execute({ sessionId: req.params.sessionId, entries, ambiguous, blank, submittedBy });
      reply(res, result);
    }));
  }

  if (gradeSubmission) {
    router.post('/sessions/:sessionId/grade', asyncHandler(async (req, res) => {
      const { entries = {}, verdicts = {}, gradedBy = null } = req.body || {};
      reply(res, await gradeSubmission.execute({ sessionId: req.params.sessionId, entries, verdicts, gradedBy }));
    }));
  }

  if (closeSessionOutcome) {
    router.post('/sessions/:sessionId/close', asyncHandler(async (req, res) => {
      const { signedOff = false } = req.body || {};
      reply(res, await closeSessionOutcome.execute({ sessionId: req.params.sessionId, signedOff: signedOff === true }));
    }));
  }

  if (openRemediation) {
    router.post('/sessions/:sessionId/remediation', asyncHandler(async (req, res) => {
      reply(res, await openRemediation.execute({ sessionId: req.params.sessionId }));
    }));
  }

  // --- the parent surface ----------------------------------------------------
  if (reviewQueue) {
    router.get('/review', asyncHandler(async (_req, res) => {
      res.json({ items: await reviewQueue.listPending() });
    }));

    router.get('/sessions/:sessionId/review', asyncHandler(async (req, res) => {
      res.json({ items: await reviewQueue.listForSession(req.params.sessionId) });
    }));

    router.post('/sessions/:sessionId/review/:itemId', asyncHandler(async (req, res) => {
      const { verdict, gradedBy = null } = req.body || {};
      if (verdict !== 'correct' && verdict !== 'incorrect') {
        const err = new Error(`verdict must be correct|incorrect, got: ${verdict}`);
        err.status = 400;
        throw err;
      }
      const item = await reviewQueue.resolve({
        sessionId: req.params.sessionId, itemId: req.params.itemId,
        verdict, gradedBy, at: clock().toISOString(),
      });
      if (!item) {
        const err = new Error(`no review item ${req.params.itemId} on session ${req.params.sessionId}`);
        err.status = 404;
        throw err;
      }
      res.json(item);
    }));
  }

  if (assignments) {
    router.get('/assignments', asyncHandler(async (_req, res) => {
      res.json({ assignments: await assignments.list() });
    }));

    router.get('/assignments/:learnerId', asyncHandler(async (req, res) => {
      const record = await assignments.get(req.params.learnerId);
      if (!record) {
        const err = new Error(`nothing assigned to ${req.params.learnerId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));

    router.put('/assignments/:learnerId', asyncHandler(async (req, res) => {
      const { courses = [], units = [] } = req.body || {};
      if (!Array.isArray(courses) || !Array.isArray(units)) {
        const err = new Error('courses and units must be arrays');
        err.status = 400;
        throw err;
      }
      res.json(await assignments.put({
        learnerId: req.params.learnerId, courses, units, updatedAt: clock().toISOString(),
      }));
    }));
  }

  return router;
}

export default createSchoolLifecycleRouter;
