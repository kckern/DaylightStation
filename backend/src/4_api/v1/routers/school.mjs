/**
 * /api/v1/school — thin HTTP shell over SchoolService (spec §5, §8).
 * All policy lives in the service; this file only maps errors to statuses.
 */
import express from 'express';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export function createSchoolRouter({
  schoolService,
  getMaterialCatalog = null,
  getMaterialUnits = null,
  getMaterialProgressSummary = null,
  materialProgressStore = null,
  getSchoolReport = null,
  getLearningProgress = null,
  getInstructionalInsights = null,
  learningCatalog = null,
  openCatalogLearningSession = null,
  recordLearningReflection = null,
  recordLearningProbeInteraction = null,
  remediationTutor = null,
  learnerDirectory = null,
  issueContinuationCode = null,
  printService = null,
  schoolCalcRouter = null,
  logger = console,
}) {
  const router = express.Router();
  let warnedMaterialsConfigMissing = false;
  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (err instanceof SessionGoneError) return res.status(410).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (['REMEDIATION_ACTION_CONFLICT', 'REMEDIATION_ACTION_OUT_OF_ORDER'].includes(err?.code)) {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
        if (err?.code === 'ADAPTIVE_TUTOR_UNAVAILABLE') {
          return res.status(503).json({ error: err.message, code: err.code });
        }
        logger.error?.('school.router.error', { path: req.path, error: err.message });
        return res.status(500).json({ error: 'internal' });
      });
  };

  router.get('/roster', wrap(async (req, res) => res.json(
    learnerDirectory ? await learnerDirectory.listLearners() : schoolService.getRoster(),
  )));
  // Await the (async, off-thread) warm so a cold cache returns the full list
  // rather than empty — without ever blocking the event loop on the file scan.
  router.get('/banks', wrap(async (req, res) => {
    await schoolService.warmBanks();
    res.json(schoolService.listBanks({ audience: req.query.audience }));
  }));
  router.get('/banks/:bankId', wrap((req, res) => res.json(schoolService.getBank(req.params.bankId))));
  router.get('/catalogs', wrap(async (req, res) => {
    if (!learningCatalog) return res.json({ schema: 'school.catalog-index/v1', catalogs: [] });
    return res.set('Cache-Control', 'no-store').json(await learningCatalog.list({
      learnerId: textQuery(req.query.learnerId),
    }));
  }));
  router.get('/catalogs/:catalogId/subjects/:subjectId/courses/:courseId/units/:unitId/lessons/:lessonId', wrap(async (req, res) => {
    if (!learningCatalog) throw new EntityNotFoundError('School Catalog', 'not configured');
    const { catalogId, subjectId, courseId, unitId, lessonId } = req.params;
    return res.set('Cache-Control', 'no-store').json(await learningCatalog.lesson({
      catalogId, subjectId, courseId, unitId, lessonId,
      learnerId: textQuery(req.query.learnerId),
    }));
  }));
  // A continuation code is a public convenience route, not a credential. The
  // application owns stable learner-slot policy and the reversible encoding;
  // HTTP merely validates the two text query fields and returns its DTO.
  router.get('/continuation-code', wrap(async (req, res) => {
    if (!issueContinuationCode) throw new EntityNotFoundError('School continuation codes', 'not configured');
    return res.set('Cache-Control', 'no-store').json(await issueContinuationCode.execute({
      learnerId: requiredTextQuery(req.query.learnerId, 'learnerId'),
      moduleCode: requiredTextQuery(req.query.moduleCode, 'moduleCode'),
    }));
  }));
  router.get('/geography/decks', wrap((req, res) => {
    // Geography is an outer presentation here. The service/source expose only
    // generic collections and bank summaries.
    const decks = schoolService.listBankSourceSummaries({ collection: 'geography' })
      .map(({ summaryId, ...summary }) => ({ deckId: summaryId, ...summary }));
    res.json({ decks });
  }));
  router.post('/sessions', wrap((req, res) => {
    const { userId = null, bankId, mode, learning = null } = req.body || {};
    if (learning !== null) {
      if (!openCatalogLearningSession) {
        throw new EntityNotFoundError('School Catalog sessions', 'not configured');
      }
      return Promise.resolve(openCatalogLearningSession.execute({
        learnerId: userId, bankId, mode, learning,
      })).then((result) => res.json(result));
    }
    return res.json(schoolService.openSession({ userId, bankId, mode }));
  }));
  router.post('/sessions/:sessionId/answer', wrap((req, res) => {
    const {
      itemId, given, selfGrade, probeAttemptNumber = null, responseId = null,
    } = req.body || {};
    res.json(schoolService.answer({
      sessionId: req.params.sessionId, itemId, given, selfGrade,
      probeAttemptNumber, responseId,
    }));
  }));
  router.get('/users/:userId/results', wrap((req, res) => {
    res.json(schoolService.getResults(req.params.userId, { bankId: req.query.bankId }));
  }));

  // Quiz requests — the on-demand authoring backlog. POST records a child's
  // interest in a quiz for a bankless unit; GET lists the backlog (optionally
  // per material) for the requested-state UI and for whoever authors banks.
  router.post('/quiz-requests', wrap((req, res) => {
    const { userId = null, unitId, materialId, unitTitle = null, materialTitle = null } = req.body || {};
    res.json(schoolService.requestQuiz({ userId, unitId, materialId, unitTitle, materialTitle }));
  }));
  router.get('/quiz-requests', wrap((req, res) => {
    res.json(schoolService.listQuizRequests({ materialId: req.query.materialId || null }));
  }));

  // Printing — a child prints their own worksheets, quota-gated with grown-up
  // approval over the limit. A missing printService (no printer/printables
  // configured) serves empty/inert rather than 500ing the whole app.
  router.get('/print/printables', wrap(async (req, res) => {
    res.json(printService ? await printService.listPrintables() : []);
  }));
  router.get('/print/quota', wrap((req, res) => {
    if (!printService || !req.query.userId) return res.json(null);
    res.json(printService.getQuota(req.query.userId));
  }));
  router.post('/print/request', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    const { userId = null, printableId, copies = 1 } = req.body || {};
    res.json(await printService.requestPrint({ userId, printableId, copies }));
  }));
  router.get('/print/pending', wrap((req, res) => {
    res.json(printService ? printService.listPending() : []);
  }));
  router.post('/print/:requestId/approve', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    res.json(await printService.approve({ requestId: req.params.requestId, approver: req.body?.approver }));
  }));
  router.post('/print/:requestId/deny', wrap(async (req, res) => {
    if (!printService) throw new EntityNotFoundError('printing', 'not configured');
    res.json(await printService.deny({ requestId: req.params.requestId, approver: req.body?.approver }));
  }));

  // Materials framework (catalog + per-unit progress/quiz gates). The panel
  // must never 500 before materials.yml config ships — a missing config block
  // (getMaterialCatalog not wired) serves an empty catalog and logs once,
  // not per request.
  // Aggregate program report — every program x every learner in one shape.
  // Omit userId for the household board; pass it for one learner's own view.
  router.get('/report', wrap(async (req, res) => {
    if (!getSchoolReport) return res.json({ learners: [] });
    res.json(await getSchoolReport.execute({
      userId: req.query.userId || null,
      audience: req.query.audience === 'learner' ? 'learner' : 'parent',
    }));
  }));

  // Generic, evidence-backed progress: one endpoint for the School web app,
  // SchoolCalc projections, and future surfaces. Membership and academic
  // period names are resolved in the application; HTTP only parses fields.
  router.get('/progress/options', wrap(async (req, res) => {
    if (!getLearningProgress) return res.json({ learners: [], scopes: [], periods: [] });
    res.set('Cache-Control', 'no-store').json(await getLearningProgress.options());
  }));
  router.get('/progress', wrap(async (req, res) => {
    if (!getLearningProgress) return res.json(null);
    const learnerId = textQuery(req.query.learnerId);
    const scopeType = learnerId ? 'learner' : textQuery(req.query.scopeType) ?? 'household';
    const scopeId = learnerId ?? textQuery(req.query.scopeId) ?? 'household';
    const result = await getLearningProgress.execute({
      scopeType,
      scopeId,
      periodId: textQuery(req.query.periodId),
      from: textQuery(req.query.from),
      to: textQuery(req.query.to),
      filters: {
        subjectIds: csvQuery(req.query.subject),
        areaIds: csvQuery(req.query.area),
        courseIds: csvQuery(req.query.course),
        unitIds: csvQuery(req.query.unit),
        lessonIds: csvQuery(req.query.lesson),
        moduleIds: csvQuery(req.query.module),
        conceptIds: csvQuery(req.query.concept),
        activityKinds: csvQuery(req.query.activityKind),
        surfaceIds: csvQuery(req.query.surface),
        includeClassifications: csvQuery(req.query.classification),
        excludeClassifications: csvQuery(req.query.excludeClassification),
        includeTags: csvQuery(req.query.tag),
        excludeTags: csvQuery(req.query.excludeTag),
        verifications: csvQuery(req.query.verification),
      },
      groupBy: csvQuery(req.query.groupBy),
      recentLimit: boundedIntegerQuery(req.query.recentLimit, 10, 0, 100, 'recentLimit'),
      followUpContext: { surface: 'web' },
    });
    res.set('Cache-Control', 'no-store').json(result);
  }));

  // Adult-facing content and pacing signals. The application resolves cohort
  // membership; this projection never exposes rankings or ability labels.
  router.get('/progress/insights', wrap(async (req, res) => {
    if (!getInstructionalInsights) return res.json(null);
    const result = await getInstructionalInsights.execute({
      scopeType: textQuery(req.query.scopeType) ?? 'household',
      scopeId: textQuery(req.query.scopeId) ?? 'household',
      from: textQuery(req.query.from),
      to: textQuery(req.query.to),
    });
    return res.set('Cache-Control', 'no-store').json(result);
  }));

  // Optional metacognitive observation. Source identity is owned by this HTTP
  // adapter rather than accepted from a caller-supplied evidence envelope.
  router.post('/progress/reflections', wrap(async (req, res) => {
    if (!recordLearningReflection) throw new EntityNotFoundError('learning reflection', 'not configured');
    const { observationId, learnerId, activity, learning, selfRegulation } = req.body || {};
    const result = await recordLearningReflection.execute({
      observationId, learnerId, activity, learning, selfRegulation,
      source: { surface: 'web', transport: 'screen' },
    });
    return res.status(result.status === 'recorded' ? 201 : 200).json(result);
  }));

  // Feedback acknowledgement and the learner's next move remain distinct
  // from scored responses. Client observationId makes a network retry an
  // exact idempotent replay in the append-only evidence repository.
  router.post('/learning-probes/interactions', wrap(async (req, res) => {
    if (!recordLearningProbeInteraction) {
      throw new EntityNotFoundError('learning probe interaction', 'not configured');
    }
    const {
      observationId, learnerId, event, activity, learning,
      attemptNumber, continuation = null,
    } = req.body || {};
    const result = await recordLearningProbeInteraction.execute({
      observationId, learnerId, event, activity, learning,
      attemptNumber, continuation,
      source: { surface: 'web', transport: 'screen' },
    });
    return res.status(result.status === 'recorded' ? 201 : 200).json(result);
  }));

  // The adaptive learning loop is shared School behavior. Web identifies its
  // learner access scope here; calculator endpoints translate device access in
  // their own outer adapter while calling the same application service.
  router.get('/remediation', wrap(async (req, res) => {
    if (!remediationTutor) return res.json({ sessions: [] });
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    return res.set('Cache-Control', 'no-store').json({
      sessions: await remediationTutor.listAvailable({ surface: 'web', learnerId }),
    });
  }));

  router.get('/remediation/:sessionId', wrap(async (req, res) => {
    if (!remediationTutor) throw new EntityNotFoundError('adaptive remediation', 'not configured');
    const learnerId = requiredTextQuery(req.query.learnerId, 'learnerId');
    const session = await remediationTutor.get({
      sessionId: req.params.sessionId,
      access: { surface: 'web', learnerId },
      afterServerSequence: boundedIntegerQuery(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER, 'after'),
      maxTurns: boundedIntegerQuery(req.query.limit, 20, 1, 50, 'limit'),
    });
    return res.set('Cache-Control', 'no-store').json({ session });
  }));

  router.post('/remediation/:sessionId/actions', wrap(async (req, res) => {
    if (!remediationTutor) throw new EntityNotFoundError('adaptive remediation', 'not configured');
    const {
      learnerId, clientSequence, lastServerSequence, action,
      turnId = null, choiceId = null,
    } = req.body || {};
    const outcome = await remediationTutor.act({
      sessionId: req.params.sessionId,
      access: { surface: 'web', learnerId },
      clientSequence, lastServerSequence, action, turnId, choiceId,
    });
    return res.set('Cache-Control', 'no-store')
      .status(outcome.status === 'processing' ? 202 : 200).json(outcome);
  }));

  router.get('/materials', wrap(async (req, res) => {
    if (!getMaterialCatalog) {
      if (!warnedMaterialsConfigMissing) {
        warnedMaterialsConfigMissing = true;
        logger.warn?.('school.materials.config-missing');
      }
      return res.json({ sections: [], materials: [] });
    }
    res.json(await getMaterialCatalog.execute());
  }));

  // A collection's works (albums), for the collection browser. Empty for a
  // non-collection material, so the frontend can call it unconditionally.
  router.get('/materials/:materialId/works', wrap(async (req, res) => {
    if (!getMaterialCatalog?.listWorks) return res.json([]);
    res.json(await getMaterialCatalog.listWorks(req.params.materialId));
  }));

  router.get('/materials/:materialId/units', wrap(async (req, res) => {
    if (!getMaterialUnits) throw new EntityNotFoundError('material', req.params.materialId);
    const userId = req.query.userId || undefined;
    res.json(await getMaterialUnits.execute({ materialId: req.params.materialId, userId }));
  }));

  // Continue-rail data: the signed-in user's in-progress materials (newest
  // first). Not wired (no materials config) → empty rail, never an error.
  router.get('/users/:userId/material-progress', wrap(async (req, res) => {
    if (!getMaterialProgressSummary) return res.json([]);
    const subject = req.query.subject || undefined;
    res.json(await getMaterialProgressSummary.execute({ userId: req.params.userId, subject }));
  }));

  router.put('/materials/:materialId/units/:unitId/progress', wrap((req, res) => {
    const { userId, percent, playhead, durationMs } = req.body || {};
    if (!userId || !materialProgressStore) return res.json({ ok: true, recorded: false });
    materialProgressStore.record({
      userId,
      plexId: req.params.unitId,
      percent,
      seconds: playhead,
      duration: durationMs != null ? durationMs / 1000 : undefined,
    });
    return res.json({ ok: true });
  }));

  if (schoolCalcRouter) router.use('/calc', schoolCalcRouter);

  return router;
}

function textQuery(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) || typeof value !== 'string') throw new ValidationError('query value must be text');
  return value;
}

function requiredTextQuery(value, field) {
  const text = textQuery(value);
  if (text === null) throw new ValidationError(`${field} is required`);
  return text;
}

function csvQuery(value) {
  const text = textQuery(value);
  if (text === null) return [];
  const values = text.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (new Set(values).size !== values.length) throw new ValidationError('query list must not contain duplicates');
  return values;
}

function boundedIntegerQuery(value, fallback, minimum, maximum, field) {
  const text = textQuery(value);
  if (text === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new ValidationError(`${field} must be an integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ValidationError(`${field} must be from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export default createSchoolRouter;
