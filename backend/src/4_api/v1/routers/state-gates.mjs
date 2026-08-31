import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

function filters(query) {
  return {
    subjectKind: query.subjectKind,
    subjectId: query.subjectId,
    periodKind: query.periodKind,
    periodId: query.periodId,
  };
}

function instant(value) {
  if (value == null) return value;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function command(body = {}) {
  return {
    assertionId: body.assertionId,
    claimTypeId: body.claimTypeId,
    subject: body.subject,
    period: body.period ? { ...body.period, startsAt: instant(body.period.startsAt), endsAt: instant(body.period.endsAt) } : body.period,
    value: body.value,
    sourceRevision: body.sourceRevision,
    observedAt: instant(body.observedAt),
    validFrom: instant(body.validFrom ?? body.observedAt),
    validUntil: instant(body.validUntil),
    evidenceRef: body.evidenceRef,
  };
}

function oneOr404(response, definition, item, message, code) {
  if (definition) return { schema: response.schema, currentRevision: response.currentRevision, item: { definition, ...item } };
  throw Object.assign(new Error(message), { name: 'NotFoundError', code, status: 404 });
}

export function createStateGatesRouter({ operations, actorFromRequest }) {
  if (!operations || !actorFromRequest) throw new Error('createStateGatesRouter requires operations and actorFromRequest');
  const router = express.Router();

  router.get('/transitions', asyncHandler(async (req, res) => {
    try {
      res.json(await operations.replayTransitions(req.householdId, Number(req.query.afterRevision ?? 0), Number(req.query.limit ?? 100)));
    } catch (error) {
      if (error.code === 'CURSOR_EXPIRED') return res.status(410).json({ error: error.message, code: error.code, ...error.details });
      throw error;
    }
  }));

  router.post('/attestations', asyncHandler(async (req, res) => {
    res.json(await operations.observeManualAttestation(req.householdId, actorFromRequest(req), command(req.body)));
  }));

  router.delete('/attestations/:assertionId', asyncHandler(async (req, res) => {
    res.json(await operations.retractManualAttestation(req.householdId, actorFromRequest(req), {
      assertionId: req.params.assertionId,
      sourceRevision: req.body?.sourceRevision,
      retractedAt: instant(req.body?.retractedAt),
      evidenceRef: req.body?.evidenceRef,
    }));
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await operations.getCurrentGates(req.householdId, filters(req.query)));
  }));

  router.get('/:gateId', asyncHandler(async (req, res) => {
    const response = await operations.getCurrentGates(req.householdId, { ...filters(req.query), gateId: req.params.gateId });
    const evaluated = response.items.find(item => item.evaluation.gateId === req.params.gateId);
    res.json(oneOr404(response, response.definitions.find(item => item.id === req.params.gateId), { evaluation: evaluated?.evaluation ?? null }, 'Gate not found', 'GATE_NOT_FOUND'));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export function createEntitlementsRouter({ operations }) {
  if (!operations) throw new Error('createEntitlementsRouter requires operations');
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    res.json(await operations.getCurrentEntitlements(req.householdId, { ...filters(req.query), capabilityId: req.query.capabilityId }));
  }));
  router.get('/:capabilityId', asyncHandler(async (req, res) => {
    const response = await operations.getCurrentEntitlements(req.householdId, { ...filters(req.query), capabilityId: req.params.capabilityId });
    res.json(oneOr404(response, response.definitions.find(item => item.capabilityId === req.params.capabilityId), { decision: response.items.find(item => item.capabilityId === req.params.capabilityId) ?? null }, 'Entitlement not found', 'ENTITLEMENT_NOT_FOUND'));
  }));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createStateGatesRouter;
