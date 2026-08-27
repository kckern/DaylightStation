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

/**
 * @param {object} deps - each use case is optional and gates its own routes
 * @param {object} [deps.resolveScanAction]
 * @param {object} [deps.buildAgenda] - mints real sessions/tokens; gates
 *   `POST .../agenda` (the real print) together with `deps.receiptPngRenderer`.
 *   Not `GET` — a GET must never mint (readiness punch 5)
 * @param {object} [deps.previewAgenda] - dry-run twin of `buildAgenda` (Task 2);
 *   gates `GET .../agenda` and `GET .../agenda/preview`, both together with
 *   `deps.receiptPngRenderer`
 * @param {object} [deps.receiptPngRenderer] - `1_rendering`'s PNG receipt
 *   renderer (`createCanvas(document, {tokens})`); the other gate for all
 *   three agenda routes above
 * @param {object} [deps.getLearnerDayCompletion] - read-only learner-level
 *   completion projection; gates `GET .../completion`
 * @param {object} [deps.getPianoLessonGate] - read-only "does this learner owe
 *   a piano lesson right now"; gates `GET .../piano-lesson-gate`, the second
 *   read seam for the piano kiosk
 * @param {object} [deps.issueDocument]
 * @param {object} [deps.issueComposedWorksheet] - persistent multi-lesson worksheet issuer
 * @param {object} [deps.listPrintableWorksheetSessions] - teacher-safe current paper-session selector
 * @param {object} [deps.dispatchMedia]
 * @param {object} [deps.recordMediaCompletion]
 * @param {object} [deps.submitPaperWork]
 * @param {object} [deps.gradeSubmission]
 * @param {object} [deps.closeSessionOutcome]
 * @param {object} [deps.openRemediation]
 * @param {object} [deps.assignments] - IAssignmentStore, READS only
 * @param {object} [deps.reviewQueue] - IReviewQueue, READS only
 * @param {object} [deps.resolveReviewItem] - guarded sign-off; without it the
 *   sign-off route does not exist. The store is never written to directly.
 * @param {object} [deps.setAssignments] - guarded planning write; likewise
 * @param {object} [deps.syllabi] - `{get, list, save, archiveGuarded}`; save/
 *   archiveGuarded carry validation and the teacher gate themselves (composition),
 *   so this router only calls them, never the raw `YamlSyllabusStore`
 * @param {object} [deps.enrollLearner] - guarded materialize-syllabus-onto-learner write
 * @param {object} [deps.unenrollLearner] - guarded drop-course-from-learner write
 * @param {object} [deps.curriculum] - CurriculumAccess, READ-ONLY. Summaries
 *   only: a unit's `review` block holds the answer key, and this route is as
 *   reachable as any other.
 * @param {object} [deps.sessions] - IWorkSessionRepository, for session history
 * @param {object} [deps.roster] - `{displayName(id)}`, the same lookup
 *   `ResolvePersonalCard` uses; the agenda routes resolve the printed name
 *   through it so paper and preview agree without a `?name=` on every URL
 * @param {object} [deps.logger]
 * @returns {import('express').Router}
 */
export function createSchoolLifecycleRouter({
  resolveScanAction = null,
  buildAgenda = null,
  previewAgenda = null,
  getLearnerDayCompletion = null,
  getPianoLessonGate = null,
  receiptPngRenderer = null,
  issueDocument = null,
  issueComposedWorksheet = null,
  listPrintableWorksheetSessions = null,
  dispatchMedia = null,
  recordMediaCompletion = null,
  submitPaperWork = null,
  gradeSubmission = null,
  closeSessionOutcome = null,
  openRemediation = null,
  assignments = null,
  reviewQueue = null,
  resolveReviewItem = null,
  setAssignments = null,
  syllabi = null,
  enrollLearner = null,
  unenrollLearner = null,
  markSessionAbandoned = null,
  replaceLostAnswerSheet = null,
  createLostAnswerSheetTicket = null,
  curriculum = null,
  sessions = null,
  // Study-day-windowed sessions read (`?window=today`) — a use case, not an
  // inline filter, because the 4am window needs the clock+timezone this
  // router deliberately does not hold.
  listLearnerSessions = null,
  roster = null,
  // No clock: every timestamp this router used to stamp (a verdict's `gradedAt`,
  // an assignment's `updatedAt`) is now written by the use case that owns the
  // rule for it, from the one injected clock the lifecycle shares.
  logger = console,
} = {}) {
  const router = express.Router();

  const wired = Object.entries({
    resolveScanAction, buildAgenda, getLearnerDayCompletion, issueDocument, issueComposedWorksheet, dispatchMedia, recordMediaCompletion,
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
  // The printed name: an explicit `?name=` (query, or body on the minting
  // POST) wins, then the household roster's display name, then (inside the
  // use case) the learner id itself.
  const learnerName = (req) => {
    const bodyName = typeof req.body?.name === 'string' && req.body.name ? req.body.name : null;
    const queryName = typeof req.query.name === 'string' && req.query.name ? req.query.name : null;
    return bodyName || queryName || (roster?.displayName?.(req.params.learnerId) ?? null);
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
    const { canvas } = await receiptPngRenderer.createCanvas(result.document, { tokens: {} });
    const buffer = canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${result.document.id}.png"`);
    res.send(buffer);
  }

  // GET is a DRY RUN (readiness punch 5): it used to execute `buildAgenda`,
  // which mints real sessions and tokens on every load — a GET with side
  // effects. It now runs the exact same algorithm `previewAgenda` does for
  // the preview route below, never opening a session or minting a live
  // ticket. Both `previewAgenda` and `receiptPngRenderer` are required;
  // either alone is a half-configured deployment (501, not 404 or a crash) —
  // same posture as the preview route.
  if (previewAgenda && receiptPngRenderer) {
    router.get('/learners/:learnerId/agenda', asyncHandler(async (req, res) => {
      const result = await previewAgenda.execute({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
        studyDay: req.query.studyDay ?? null,
      });
      await sendAgendaPng(res, result);
    }));
  } else if (previewAgenda || receiptPngRenderer) {
    router.get('/learners/:learnerId/agenda', asyncHandler(async (_req, res) => {
      res.status(501).json({ error: 'agenda not configured' });
    }));
  }

  // POST is the real mint, for any caller that truly needs it — no known HTTP
  // caller today (the NFC path calls `handleScan` in-process), but the route
  // exists so a future one does not have to reach for the dry-run GET. Same
  // pairing rule as GET: `buildAgenda` and `receiptPngRenderer` both required.
  if (buildAgenda && receiptPngRenderer) {
    router.post('/learners/:learnerId/agenda', asyncHandler(async (req, res) => {
      const result = await buildAgenda.execute({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
      });
      await sendAgendaPng(res, result);
    }));
  } else if (buildAgenda || receiptPngRenderer) {
    router.post('/learners/:learnerId/agenda', asyncHandler(async (_req, res) => {
      res.status(501).json({ error: 'agenda not configured' });
    }));
  }

  // --- agenda preview (dry-run PNG, no working ticket) ----------------------
  // A parent/planning surface, not the console: same document `buildAgenda`
  // would print, rendered straight to a PNG rather than issued to paper. The
  // preview builder is configured without a ticket/code, so this image cannot
  // masquerade as a usable learner agenda. Both
  // `previewAgenda` (composition's dry-run twin of `buildAgenda`, spec §3 —
  // never opens a session, never mints a live ticket) and `receiptPngRenderer`
  // (the `1_rendering` PNG renderer) are required; either alone is a
  // half-configured deployment, which answers 501 rather than 404 or a crash.
  if (previewAgenda && receiptPngRenderer) {
    router.get('/learners/:learnerId/agenda/preview', asyncHandler(async (req, res) => {
      const result = await previewAgenda.execute({
        learnerId: req.params.learnerId,
        learnerName: learnerName(req),
        studyDay: req.query.studyDay ?? null,
      });
      // The teacher console's morning drill-in (advocacy A3): the same
      // dry-run plan as DATA — subject sections with next/served — instead
      // of the printed PNG. No side effects either way (previewAgenda never
      // opens a session or mints a live ticket).
      if (req.query.format === 'json') {
        return res.set('Cache-Control', 'private, no-store')
          .set('X-School-Preview', 'agenda-non-recording').json({
          learnerId: req.params.learnerId,
          studyDay: req.query.studyDay ?? null,
          sections: result.sections ?? [],
          entries: result.plan?.entries ?? [],
          // Planner refusals (admin advocacy A4): a dead course id used to
          // surface only as a warn log — now the console can render it.
          errors: result.plan?.errors ?? [],
        });
      }
      res.set('Cache-Control', 'private, no-store').set('X-School-Preview', 'agenda-non-recording');
      await sendAgendaPng(res, result);
    }));
  } else if (previewAgenda || receiptPngRenderer) {
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
  if (sessions) {
    router.get('/learners/:learnerId/sessions', asyncHandler(async (req, res) => {
      res.json({
        sessions: listLearnerSessions
          ? await listLearnerSessions.execute({ learnerId: req.params.learnerId, window: req.query.window ?? null })
          : await sessions.listForLearner(req.params.learnerId),
      });
    }));

    router.get('/sessions/:sessionId/events', asyncHandler(async (req, res) => {
      res.json({ events: await sessions.readEvents(req.params.sessionId) });
    }));

    if (listPrintableWorksheetSessions) {
      router.get('/learners/:learnerId/printable-sessions', asyncHandler(async (req, res) => {
        res.json({ sessions: await listPrintableWorksheetSessions.execute({
          learnerId: req.params.learnerId, window: req.query.window ?? 'today',
        }) });
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
    router.post('/sessions/:sessionId/grade', guarded(async (req, res) => {
      const {
        entries = {}, verdicts = {}, gradedBy = null, pin = null,
      } = req.body || {};
      reply(res, await gradeSubmission.execute({
        sessionId: req.params.sessionId, entries, verdicts, gradedBy, pin,
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
      if (req.query.format === 'png' && receiptPngRenderer) {
        const { canvas } = await receiptPngRenderer.createCanvas(result.document, { tokens: {} });
        const buffer = canvas.toBuffer('image/png');
        return res.type('image/png').send(buffer);
      }
      return reply(res, result);
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

  }

  // Signing off is a PARENT-ONLY WRITE, so it goes through the use case that
  // checks who is asking — never through `reviewQueue.resolve`, which writes
  // whatever `gradedBy` it is handed. With the use case unwired this route does
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

  // --- the catalog, read-only ------------------------------------------------
  // Enough for a queue to name the unit it is asking about and a planner to
  // offer a real list instead of a text box. There is no write here and there
  // is not meant to be: assignments are planner config, and the published
  // catalog is edited on disk (spec §7.2).
  if (curriculum) {
    router.get('/curriculum/units', asyncHandler(async (_req, res) => {
      res.json({ units: await curriculum.listUnitSummaries() });
    }));

    router.get('/curriculum/units/:unitId', asyncHandler(async (req, res) => {
      const unit = await curriculum.getUnitSummary(req.params.unitId);
      if (!unit) {
        const err = new Error(`no published unit ${req.params.unitId}`);
        err.status = 404;
        throw err;
      }
      res.json(unit);
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
  if (syllabi) {
    router.get('/syllabi', asyncHandler(async (_req, res) => {
      res.json({ syllabi: await syllabi.list() });
    }));

    router.get('/syllabi/:syllabusId', asyncHandler(async (req, res) => {
      const record = await syllabi.get(req.params.syllabusId);
      if (!record) {
        const err = new Error(`no syllabus ${req.params.syllabusId}`);
        err.status = 404;
        throw err;
      }
      res.json(record);
    }));

    router.put('/syllabi/:syllabusId', guarded(async (req, res) => {
      const { editedBy = null, pin = null, ...body } = req.body || {};
      res.json(await syllabi.save({
        raw: { ...body, syllabusId: req.params.syllabusId },
        editedBy,
        pin,
      }));
    }));

    router.post('/syllabi/:syllabusId/archive', guarded(async (req, res) => {
      const { archivedBy = null, pin = null } = req.body || {};
      const record = await syllabi.archiveGuarded({ syllabusId: req.params.syllabusId, archivedBy, pin });
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
