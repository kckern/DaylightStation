/**
 * /api/v1/school/lifecycle — HTTP over the physical console (spec §5–§9).
 *
 * A thin shell, like every other router here: it reads the request, calls one
 * use case, and returns what came back. All policy — who may do what, when a
 * ticket is still valid, what prints — lives in the use cases.
 *
 * THAT INCLUDES WHO MAY WRITE. The two parent-only writes on this router —
 * signing off a review item and changing a learner's assignments — used to call
 * their stores directly, taking the actor's id as a free string and writing it
 * verbatim. A child with curl could sign off their own sheet. Both now go
 * through use cases that check the id against the household roster before
 * anything is written (`ResolveReviewItem`, `SetAssignments`), and neither route
 * is registered unless its guarded use case was injected. Read routes are
 * unchanged: the gate is on the write.
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
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

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
  // The hard checkpoint gate refusing a completion. 409 rather than 200 is the
  // point: the body says `released: false`, but a client that reads only the
  // status code would otherwise take the refusal for a finished lesson — and
  // that client is a screen in front of a child who did not answer the
  // questions. Same family as `not_playing`: the request was well formed, the
  // session simply is not where it would have to be.
  checkpoints_outstanding: 409,
  // The printer is a device this route talks through, so its silence is a
  // gateway failure. A document that could not be DRAWN is not — the request
  // named content this server cannot turn into a sheet, which is 422, and
  // reporting it as 502 would send an operator to the printer.
  print_failed: 502,
  render_failed: 422,
  uncorrelated: 204,
});

const httpStatusFor = (outcome) => STATUS_BY_OUTCOME[outcome] ?? 200;

/**
 * Domain error NAMES that mean "you are not allowed to do this".
 *
 * Matched by name rather than `instanceof` because `4_api` may not import
 * `#domains/*` (`api-no-domains`). The status is the one the print path already
 * returns for the same class, so a refused sign-off and a refused print approval
 * look identical from a browser. Everything else falls through to
 * `errorHandlerMiddleware`, which maps by name already.
 */
const FORBIDDEN_ERROR_NAMES = new Set(['GuestForbiddenError']);

/**
 * Run a handler and stamp an authorisation refusal with its HTTP status.
 * The refusal itself is decided in the use case; this only names the number.
 */
const guarded = (fn) => asyncHandler(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (FORBIDDEN_ERROR_NAMES.has(err?.name) && err.status === undefined) err.status = 403;
    throw err;
  }
});

/** Send a use-case result at the status its own outcome implies. */
function reply(res, result) {
  const status = httpStatusFor(result?.status);
  if (status === 204) return res.status(204).end();
  return res.status(status).json(result);
}

const cookieValue = (req, name) => {
  const raw = req.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
};

// Lifecycle GETs do not pass through the body-based capability substitution
// used by ordinary School writes. Read the same HttpOnly teacher-session
// cookie here so opening a held-scan queue is genuinely teacher-gated without
// putting a PIN or bearer token in the URL.
const capabilityProof = (req) => {
  const capabilityToken = cookieValue(req, 'daylight_teacher_session');
  return capabilityToken ? {
    capabilityToken,
    stepUpToken: req.get('X-Teacher-Step-Up') ?? null,
  } : null;
};

/**
 * @param {object} deps - each use case is optional and gates its own routes
 * @param {object} [deps.resolveScanAction]
 * @param {object} [deps.lifecycleAgendaResource] - agenda preview/issue and
 *   PNG resource production, with exact partial-wiring availability
 * @param {object} [deps.lifecycleReadService] - sessions, review, curriculum,
 *   and assignment projections
 * @param {object} [deps.lifecycleSyllabusService] - guarded syllabus queries
 *   and commands
 * @param {object} [deps.getLearnerDayCompletion] - read-only learner-level
 *   completion projection; gates `GET .../completion`
 * @param {object} [deps.getPianoLessonGate] - read-only "does this learner owe
 *   a piano lesson right now"; gates `GET .../piano-lesson-gate`, the second
 *   read seam for the piano kiosk
 * @param {object} [deps.issueDocument]
 * @param {object} [deps.issueComposedWorksheet] - persistent multi-lesson worksheet issuer
 * @param {object} [deps.dispatchMedia]
 * @param {object} [deps.recordMediaCompletion]
 * @param {object} [deps.submitPaperWork]
 * @param {object} [deps.gradeSubmission]
 * @param {object} [deps.closeSessionOutcome]
 * @param {object} [deps.openRemediation]
 * @param {object} [deps.replaceRemediation] - guarded replacement of an
 *   already-issued retry that has no learner evidence
 * @param {object} [deps.resolveReviewItem] - guarded sign-off; without it the
 *   sign-off route does not exist. The store is never written to directly.
 * @param {object} [deps.setAssignments] - guarded planning write; likewise
 * @param {object} [deps.enrollLearner] - guarded materialize-syllabus-onto-learner write
 * @param {object} [deps.unenrollLearner] - guarded drop-course-from-learner write
 * @param {object} [deps.logger]
 * @returns {import('express').Router}
 */
export function createSchoolLifecycleRouter({
  resolveScanAction = null,
  lifecycleAgendaResource = null,
  lifecycleReadService = null,
  lifecycleSyllabusService = null,
  getLearnerDayCompletion = null,
  getPianoLessonGate = null,
  issueDocument = null,
  issueComposedWorksheet = null,
  dispatchMedia = null,
  recordMediaCompletion = null,
  submitPaperWork = null,
  gradeSubmission = null,
  closeSessionOutcome = null,
  openRemediation = null,
  replaceRemediation = null,
  resolveReviewItem = null,
  reviewHeldCardScan = null,
  setAssignments = null,
  enrollLearner = null,
  unenrollLearner = null,
  markSessionAbandoned = null,
  replaceLostAnswerSheet = null,
  createLostAnswerSheetTicket = null,
  // Study-day-windowed sessions read (`?window=today`) — a use case, not an
  // inline filter, because the 4am window needs the clock+timezone this
  // router deliberately does not hold.
  // No clock: every timestamp this router used to stamp (a verdict's `gradedAt`,
  // an assignment's `updatedAt`) is now written by the use case that owns the
  // rule for it, from the one injected clock the lifecycle shares.
  logger = console,
} = {}) {
  const router = express.Router();

  const wired = Object.entries({
    resolveScanAction,
    agenda: Boolean(lifecycleAgendaResource && lifecycleAgendaResource.issueAvailability() !== 'absent'),
    lifecycleReadService,
    lifecycleSyllabusService,
    getLearnerDayCompletion, issueDocument, issueComposedWorksheet, dispatchMedia, recordMediaCompletion,
    submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation, replaceRemediation,
    resolveReviewItem, reviewHeldCardScan, setAssignments, enrollLearner, unenrollLearner, markSessionAbandoned,
    replaceLostAnswerSheet, createLostAnswerSheetTicket,
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
  // The printed name: an explicit `?name=` (query, or body on the minting
  // POST) wins, then the household roster's display name, then (inside the
  // use case) the learner id itself.
  const learnerName = (req) => {
    const bodyName = typeof req.body?.name === 'string' && req.body.name ? req.body.name : null;
    const queryName = typeof req.query.name === 'string' && req.query.name ? req.query.name : null;
    return lifecycleAgendaResource?.learnerName?.(req.params.learnerId, bodyName || queryName) ?? null;
  };

  // Shared PNG plumbing (readiness punch 5): `GET .../agenda` (dry run),
  // `GET .../agenda/preview`, and `POST .../agenda` (the real mint) all render
  // the SAME kind of document to the SAME kind of PNG — one place to do it.
  // The document's own `scan_action.action` fields already carry the real (or
  // dry-run) token values, so an empty tokens map falls back to them — see
  // `actionOp` in `DocumentReceiptRenderer.mjs`. `result.document.id` is
  // already the slugged, filename-safe id `agendaDocument`/`noticeDocument`
  // computed in `2_domains` (`agenda-<learner>` for a real learner, `notice-
  // <slug>` for the guest/no-learner slip) — reusing it here means this
  // router never needs its own `#domains` import (`api-no-domains`) just to
  // slug a filename.
  async function sendAgendaPng(res, result) {
    const buffer = await lifecycleAgendaResource.render(result.document);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${result.document.id}.png"`);
    res.send(buffer);
  }

  // GET is a DRY RUN (readiness punch 5): it used to issue a live agenda,
  // which mints real sessions and tokens on every load — a GET with side
  // effects. It now uses the lifecycle agenda resource's preview operation for
  // the preview route below, never opening a session or minting a live
  // ticket. Both preview construction and PNG rendering are required;
  // either alone is a half-configured deployment (501, not 404 or a crash) —
  // same posture as the preview route.
  if (lifecycleAgendaResource?.previewAvailability?.() === 'ready') {
    router.get('/learners/:learnerId/agenda', asyncHandler(async (req, res) => {
      const result = await lifecycleAgendaResource.preview({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
        studyDay: req.query.studyDay ?? null,
      });
      await sendAgendaPng(res, result);
    }));
  } else if (lifecycleAgendaResource?.previewAvailability?.() === 'partial') {
    router.get('/learners/:learnerId/agenda', asyncHandler(async (_req, res) => {
      res.status(501).json({ error: 'agenda not configured' });
    }));
  }

  // POST is the real mint, for any caller that truly needs it — no known HTTP
  // caller today (the NFC path calls `handleScan` in-process), but the route
  // exists so a future one does not have to reach for the dry-run GET. Same
  // pairing rule as GET: agenda issuing and PNG rendering are both required.
  if (lifecycleAgendaResource?.issueAvailability?.() === 'ready') {
    router.post('/learners/:learnerId/agenda', asyncHandler(async (req, res) => {
      const result = await lifecycleAgendaResource.issue({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
      });
      await sendAgendaPng(res, result);
    }));
  } else if (lifecycleAgendaResource?.issueAvailability?.() === 'partial') {
    router.post('/learners/:learnerId/agenda', asyncHandler(async (_req, res) => {
      res.status(501).json({ error: 'agenda not configured' });
    }));
  }

  // --- agenda preview (dry-run PNG, no working ticket) ----------------------
  // A parent/planning surface, not the console: the same document issuing
  // would print, rendered straight to a PNG rather than issued to paper. The
  // preview builder is configured without a ticket/code, so this image cannot
  // masquerade as a usable learner agenda. Both
  // preview operation (the dry-run twin of issuing, spec §3 — never opens a
  // session or mints a live ticket) and PNG rendering are required; either alone is a
  // half-configured deployment, which answers 501 rather than 404 or a crash.
  if (lifecycleAgendaResource?.previewAvailability?.() === 'ready') {
    router.get('/learners/:learnerId/agenda/preview', asyncHandler(async (req, res) => {
      const result = await lifecycleAgendaResource.preview({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
        studyDay: req.query.studyDay ?? null,
      });
      // The teacher console's morning drill-in (advocacy A3): the same
      // dry-run plan as DATA — subject sections with next/served — instead
      // of the printed PNG. No side effects either way (preview never
      // opens a session or mints a live ticket).
      if (req.query.format === 'json') {
        return res.set('Cache-Control', 'private, no-store')
          .set('X-School-Preview', 'agenda-non-recording').json({
          learnerId: req.params.learnerId,
          studyDay: req.query.studyDay ?? null,
          sections: presentPublicResources(result.sections ?? []),
          entries: presentPublicResources(result.plan?.entries ?? []),
          // Planner refusals (admin advocacy A4): a dead course id used to
          // surface only as a warn log — now the console can render it.
          errors: result.plan?.errors ?? [],
        });
      }
      res.set('Cache-Control', 'private, no-store').set('X-School-Preview', 'agenda-non-recording');
      await sendAgendaPng(res, result);
    }));
  } else if (lifecycleAgendaResource?.previewAvailability?.() === 'partial') {
    // Same not-configured posture as `gratitude.mjs`'s card endpoint: one half
    // of the pair present and the other missing is a deployment gap, not a
    // 404 — the route exists, it just cannot answer yet.
    router.get('/learners/:learnerId/agenda/preview', asyncHandler(async (_req, res) => {
      res.status(501).json({ error: 'agenda preview not configured' });
    }));
  }

  // --- learner-day completion (read only) ----------------------------------
  // This is the public read seam for consumers such as the piano kiosk. It
  // deliberately exposes the three-state value instead of turning it into a
  // boolean here: each consumer owns whether `no_work_today` counts.
  if (getLearnerDayCompletion) {
    router.get('/learners/:learnerId/completion', asyncHandler(async (req, res) => {
      const result = await getLearnerDayCompletion.execute({ learnerId: req.params.learnerId });
      res.set('Cache-Control', 'no-store').json(result);
    }));
  }

  // --- piano lesson gate (read only) ----------------------------------------
  // The second read seam for the piano kiosk, beside `/completion` above: that
  // one answers "is the whole school day done" (which gates Games), this one
  // answers "does this learner owe a piano lesson right now, and which one"
  // (which gates the kiosk menu). Unwired — a composition with no piano course
  // — 404s, and the kiosk hook fails open to the ordinary menu.
  if (getPianoLessonGate) {
    router.get('/learners/:learnerId/piano-lesson-gate', asyncHandler(async (req, res) => {
      const result = await getPianoLessonGate.execute({ learnerId: req.params.learnerId });
      res.set('Cache-Control', 'no-store').json(result);
    }));
  }

  // --- sessions -------------------------------------------------------------
  if (lifecycleReadService?.hasSessions?.()) {
    router.get('/learners/:learnerId/sessions', asyncHandler(async (req, res) => {
      res.json({
        sessions: await lifecycleReadService.learnerSessions(req.params.learnerId, req.query.window ?? null),
      });
    }));

    router.get('/sessions/:sessionId/events', asyncHandler(async (req, res) => {
      res.json({ events: await lifecycleReadService.sessionEvents(req.params.sessionId) });
    }));

    if (lifecycleReadService.hasPrintableSessions()) {
      router.get('/learners/:learnerId/printable-sessions', asyncHandler(async (req, res) => {
        res.json({ sessions: await lifecycleReadService.printableSessions(
          req.params.learnerId, req.query.window ?? 'today',
        ) });
      }));
    }
  }

  if (issueDocument) {
    router.post('/sessions/:sessionId/issue', asyncHandler(async (req, res) => {
      reply(res, await issueDocument.execute({ sessionId: req.params.sessionId }));
    }));
  }

  if (issueComposedWorksheet) {
    router.post('/worksheets/compose', asyncHandler(async (req, res) => {
      const { sessionIds = [], issuedBy = null, pin = null } = req.body || {};
      reply(res, await issueComposedWorksheet.execute({ sessionIds, issuedBy, pin }));
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
    // `gradedBy` is checked in the use case whenever verdicts are present: a
    // person's mark overrides the engine, so it has to be a person who may.
    // `pin` is forwarded unconditionally — the use case only ever consults it
    // when a `teacherGate` is wired AND verdicts are on the call.
    //
    // `settle` says this call is the teacher console finishing stuck work by
    // hand rather than a scan or the finisher closing the loop. It carries no
    // verdicts, so it would meet no gate at all; the use case charges it a
    // `sessions.settle` step-up instead. The flag is the only thing added to
    // this route's contract — nothing about how the work is marked changes.
    router.post('/sessions/:sessionId/grade', guarded(async (req, res) => {
      const {
        entries = {}, verdicts = {}, gradedBy = null, pin = null,
        settle = false, settledBy = null,
      } = req.body || {};
      reply(res, await gradeSubmission.execute({
        sessionId: req.params.sessionId, entries, verdicts, gradedBy, pin,
        settle: settle === true, settledBy,
      }));
    }));
  }

  if (closeSessionOutcome) {
    // Closing is open; claiming the grown-up's approval that releases a reward
    // is not, and the use case checks `signedOffBy` for it. `pin` is forwarded
    // unconditionally — consulted only when a `teacherGate` is wired AND
    // `signedOff` is true.
    router.post('/sessions/:sessionId/close', guarded(async (req, res) => {
      const { signedOff = false, signedOffBy = null, pin = null } = req.body || {};
      reply(res, await closeSessionOutcome.execute({
        sessionId: req.params.sessionId, signedOff: signedOff === true, signedOffBy, pin,
      }));
    }));
  }

  if (openRemediation) {
    router.post('/sessions/:sessionId/remediation', asyncHandler(async (req, res) => {
      reply(res, await openRemediation.execute({ sessionId: req.params.sessionId }));
    }));
  }

  if (replaceRemediation) {
    router.post('/sessions/:sessionId/remediation/replace', guarded(async (req, res) => {
      const {
        currentSessionId = null,
        reason = null,
        replacedBy = null,
        pin = null,
        idempotencyKey = null,
      } = req.body || {};
      reply(res, await replaceRemediation.execute({
        sessionId: req.params.sessionId,
        currentSessionId,
        reason,
        replacedBy,
        pin,
        idempotencyKey,
      }));
    }));
  }

  // A lost physical answer sheet is a parent operation. The immediate route
  // performs it now; the ticket route mints a short-lived, one-card QR whose
  // later scan performs the same operation and then revokes itself.
  if (replaceLostAnswerSheet) {
    router.post('/answer-sheets/:cardId/lost', guarded(async (req, res) => {
      const { reportedBy = null, pin = null } = req.body || {};
      reply(res, await replaceLostAnswerSheet.execute({
        cardId: req.params.cardId, reportedBy, pin,
      }));
    }));
  }
  if (createLostAnswerSheetTicket) {
    router.post('/answer-sheets/:cardId/lost-ticket', guarded(async (req, res) => {
      const { requestedBy = null, pin = null } = req.body || {};
      const result = await createLostAnswerSheetTicket.execute({
        cardId: req.params.cardId, requestedBy, pin,
      });
      if (req.query.format === 'png' && lifecycleAgendaResource?.canRender?.()) {
        const buffer = await lifecycleAgendaResource.render(result.document);
        return res.type('image/png').send(buffer);
      }
      return reply(res, result);
    }));
  }

  // --- the parent surface ----------------------------------------------------
  if (lifecycleReadService?.hasReview?.()) {
    router.get('/review', asyncHandler(async (_req, res) => {
      res.json({ items: await lifecycleReadService.pendingReview() });
    }));

    router.get('/sessions/:sessionId/review', asyncHandler(async (req, res) => {
      res.json({ items: await lifecycleReadService.sessionReview(req.params.sessionId) });
    }));

  }

  // Signing off is a PARENT-ONLY WRITE, so it goes through the use case that
  // checks who is asking — never through the underlying review store, which
  // writes whatever `gradedBy` it is handed. With the use case unwired this route does
  // not exist at all: a deployment missing the guard refuses the write rather
  // than performing it unguarded.
  if (resolveReviewItem) {
    router.post('/sessions/:sessionId/review/:itemId', guarded(async (req, res) => {
      const { verdict, gradedBy = null, note = null, pin = null } = req.body || {};
      res.json(await resolveReviewItem.execute({
        sessionId: req.params.sessionId, itemId: req.params.itemId, verdict, gradedBy, note, pin,
      }));
    }));
  }

  // Answer-sheet identity holds are grouped scan reviews, deliberately
  // separate from the per-question verdict queue above.
  if (reviewHeldCardScan) {
    router.get('/answer-sheet-reviews', guarded(async (req, res) => {
      res.json({ items: await reviewHeldCardScan.list({
        reviewerId: req.query.reviewerId ?? null,
        pin: capabilityProof(req),
      }) });
    }));
    router.get('/answer-sheet-reviews/:heldScanId', guarded(async (req, res) => {
      res.json(await reviewHeldCardScan.inspect({
        heldScanId: req.params.heldScanId,
        reviewerId: req.query.reviewerId ?? null,
        pin: capabilityProof(req),
      }));
    }));
    router.post('/answer-sheet-reviews/:heldScanId/resolve', guarded(async (req, res) => {
      const {
        action, targetRecordId = null, reviewerId = null, pin = null, idempotencyKey = null,
      } = req.body || {};
      res.json(await reviewHeldCardScan.resolve({
        heldScanId: req.params.heldScanId, action, targetRecordId,
        reviewerId, pin: pin ?? capabilityProof(req), idempotencyKey,
      }));
    }));
    router.post('/answer-sheets/:cardId/quarantines/:quarantineId/clear', guarded(async (req, res) => {
      const { method, reviewerId = null, pin = null } = req.body || {};
      res.json(await reviewHeldCardScan.clearQuarantine({
        cardId: req.params.cardId, quarantineId: req.params.quarantineId,
        method, reviewerId, pin: pin ?? capabilityProof(req),
      }));
    }));
  }

  // --- the catalog, read-only ------------------------------------------------
  // Enough for a queue to name the unit it is asking about and a planner to
  // offer a real list instead of a text box. There is no write here and there
  // is not meant to be: assignments are planner config, and the published
  // catalog is edited on disk (spec §7.2).
  if (lifecycleReadService?.hasCurriculum?.()) {
    router.get('/curriculum/units', asyncHandler(async (_req, res) => {
      res.json({ units: await lifecycleReadService.units() });
    }));

    router.get('/curriculum/units/:unitId', asyncHandler(async (req, res) => {
      const unit = await lifecycleReadService.unit(req.params.unitId);
      if (!unit) {
        const err = new Error(`no published unit ${req.params.unitId}`);
        err.status = 404;
        throw err;
      }
      res.json(unit);
    }));
  }

  if (lifecycleReadService?.hasAssignments?.()) {
    router.get('/assignments', asyncHandler(async (_req, res) => {
      res.json({ assignments: await lifecycleReadService.assignmentList() });
    }));

    router.get('/assignments/:learnerId', asyncHandler(async (req, res) => {
      const record = await lifecycleReadService.assignment(req.params.learnerId);
      if (!record) {
        const err = new Error(`nothing assigned to ${req.params.learnerId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));

  }

  // Same shape as the sign-off: the planning WRITE is adult-only and lives in
  // its use case, while the reads above stay open.
  if (markSessionAbandoned) {
    // The stale-work sweep (admin advocacy A5): who never came back.
    router.get('/sessions/stale', guarded(async (req, res) => {
      const olderThanDays = Number.parseInt(req.query.olderThanDays, 10);
      res.json({
        sessions: await markSessionAbandoned.listStale({
          olderThanDays: Number.isFinite(olderThanDays) && olderThanDays > 0 ? olderThanDays : 7,
        }),
      });
    }));
    router.post('/sessions/:sessionId/abandon', guarded(async (req, res) => {
      const { learnerId, reason, decidedBy = null, pin = null } = req.body || {};
      res.json(await markSessionAbandoned.execute({
        sessionId: req.params.sessionId, learnerId, reason, decidedBy, pin,
      }));
    }));
  }

  if (setAssignments) {
    router.put('/assignments/:learnerId', guarded(async (req, res) => {
      const { courses = [], units = [], programs = [], assignedBy = null, pin = null, baseUpdatedAt } = req.body || {};
      res.json(await setAssignments.execute({
        learnerId: req.params.learnerId, courses, units, programs, assignedBy, pin, baseUpdatedAt,
      }));
    }));
  }

  // --- syllabi: the saved arguments a materialized enrollment is built from ---
  if (lifecycleSyllabusService?.isConfigured?.()) {
    router.get('/syllabi', asyncHandler(async (_req, res) => {
      res.json({ syllabi: await lifecycleSyllabusService.list() });
    }));

    router.get('/syllabi/:syllabusId', asyncHandler(async (req, res) => {
      const record = await lifecycleSyllabusService.get(req.params.syllabusId);
      if (!record) {
        const err = new Error(`no syllabus ${req.params.syllabusId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));

    router.put('/syllabi/:syllabusId', guarded(async (req, res) => {
      const { editedBy = null, pin = null, ...body } = req.body || {};
      res.json(await lifecycleSyllabusService.save({
        raw: { ...body, syllabusId: req.params.syllabusId },
        editedBy,
        pin,
      }));
    }));

    router.post('/syllabi/:syllabusId/archive', guarded(async (req, res) => {
      const { archivedBy = null, pin = null } = req.body || {};
      const record = await lifecycleSyllabusService.archive({ syllabusId: req.params.syllabusId, archivedBy, pin });
      if (!record) {
        const err = new Error(`no syllabus ${req.params.syllabusId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));
  }

  if (enrollLearner) {
    router.post('/enrollments/:learnerId', guarded(async (req, res) => {
      const { syllabusId, timingAnchorId = null, rematerialize = false, enrolledBy = null, pin = null, baseUpdatedAt } = req.body || {};
      res.json(await enrollLearner.execute({
        learnerId: req.params.learnerId, syllabusId, rematerialize: rematerialize === true,
        timingAnchorId, enrolledBy, pin, baseUpdatedAt,
      }));
    }));
  }

  if (unenrollLearner) {
    router.delete('/enrollments/:learnerId/:courseId', guarded(async (req, res) => {
      const { removedBy = null, pin = null, baseUpdatedAt } = req.body || {};
      res.json(await unenrollLearner.execute({
        learnerId: req.params.learnerId, courseId: req.params.courseId, removedBy, pin, baseUpdatedAt,
      }));
    }));
  }

  // Status stamping at this boundary, by NAME (api-no-domains forbids the
  // classes): the app-level object-shape error handler maps by explicit
  // `err.status` first, and without a stamp a lifecycle refusal or missing
  // entity surfaced as an anonymous 500 — which no client (the teacher
  // console's PIN prompt keys on 403; the panels' empty-mapping keys on 404)
  // can act on. Stamp-and-forward: the shape stays the handler's.
  const STATUS_BY_ERROR_NAME = Object.freeze({
    GuestForbiddenError: 403,
    EntityNotFoundError: 404,
    ValidationError: 400,
    ConflictError: 409,
    DomainInvariantError: 409,
  });
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err && err.status === undefined && STATUS_BY_ERROR_NAME[err.name] !== undefined) {
      err.status = STATUS_BY_ERROR_NAME[err.name];
    }
    next(err);
  });

  return router;
}

export default createSchoolLifecycleRouter;
