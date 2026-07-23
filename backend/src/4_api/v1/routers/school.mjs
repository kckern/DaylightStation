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
  printService = null,
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

  return router;
}

export default createSchoolRouter;
