import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const SUBJECT_KINDS = new Set(['learner', 'room', 'device', 'household']);
const PERIOD_KINDS = new Set(['instant', 'local_day', 'local_week', 'interval', 'occurrence']);
const NAMESPACED_ID = /^[a-z0-9][a-z0-9._:-]*\.[a-z0-9][a-z0-9._:-]*$/i;

function requestError(message, code, field) {
  return Object.assign(new Error(message), {
    name: 'StateGatesApplicationError', status: 400, code, field,
  });
}

function scalarQuery(query, field, code = 'INVALID_QUERY_FILTER') {
  const value = query?.[field];
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw requestError(`${field} must be a non-empty scalar value`, code, field);
  }
  return value.trim();
}

function filterId(query, field) {
  const value = scalarQuery(query, field);
  if (value == null) return undefined;
  if (value.length > 160) throw requestError(`${field} is too long`, 'INVALID_QUERY_FILTER', field);
  return value;
}

function filterKind(query, field, allowed) {
  const value = scalarQuery(query, field);
  if (value != null && !allowed.has(value)) {
    throw requestError(`${field} is unsupported`, 'INVALID_QUERY_FILTER', field);
  }
  return value;
}

function namespacedId(value, field, code = 'INVALID_QUERY_FILTER') {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || !NAMESPACED_ID.test(value)) {
    throw requestError(`${field} must be a namespaced identifier`, code, field);
  }
  return value;
}

function filters(query) {
  return {
    subjectKind: filterKind(query, 'subjectKind', SUBJECT_KINDS),
    subjectId: filterId(query, 'subjectId'),
    periodKind: filterKind(query, 'periodKind', PERIOD_KINDS),
    periodId: filterId(query, 'periodId'),
  };
}

function replayInteger(query, field, fallback, { allowZero, code }) {
  const value = scalarQuery(query, field, code);
  if (value == null) return fallback;
  const pattern = allowZero ? /^(0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(value)) throw requestError(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`, code, field);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw requestError(`${field} is outside the supported integer range`, code, field);
  return parsed;
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
      const afterRevision = replayInteger(req.query, 'afterRevision', 0, { allowZero: true, code: 'INVALID_REPLAY_CURSOR' });
      const limit = replayInteger(req.query, 'limit', 100, { allowZero: false, code: 'INVALID_REPLAY_LIMIT' });
      res.json(await operations.replayTransitions(req.householdId, afterRevision, limit));
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
    const gateId = namespacedId(req.params.gateId, 'gateId');
    const response = await operations.getCurrentGates(req.householdId, { ...filters(req.query), gateId });
    const evaluated = response.items.find(item => item.evaluation.gateId === gateId);
    res.json(oneOr404(response, response.definitions.find(item => item.id === gateId), { evaluation: evaluated?.evaluation ?? null }, 'Gate not found', 'GATE_NOT_FOUND'));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export function createEntitlementsRouter({ operations }) {
  if (!operations) throw new Error('createEntitlementsRouter requires operations');
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    const capabilityId = scalarQuery(req.query, 'capabilityId');
    res.json(await operations.getCurrentEntitlements(req.householdId, {
      ...filters(req.query),
      capabilityId: capabilityId == null ? undefined : namespacedId(capabilityId, 'capabilityId'),
    }));
  }));
  router.get('/:capabilityId', asyncHandler(async (req, res) => {
    const capabilityId = namespacedId(req.params.capabilityId, 'capabilityId');
    const response = await operations.getCurrentEntitlements(req.householdId, { ...filters(req.query), capabilityId });
    res.json(oneOr404(response, response.definitions.find(item => item.capabilityId === capabilityId), { decision: response.items.find(item => item.capabilityId === capabilityId) ?? null }, 'Entitlement not found', 'ENTITLEMENT_NOT_FOUND'));
  }));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createStateGatesRouter;
