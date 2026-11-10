import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

function redact(str) {
  return str
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
    .replace(/key[=:]\s*[^\s&]+/gi, 'key=[REDACTED]');
}

function redactFailedResult(result) {
  const data = { ...result };
  for (const field of ['error', 'reason']) {
    if (typeof data[field] === 'string') data[field] = redact(data[field]);
  }
  return data;
}

function redactHealth(health) {
  if (!health || typeof health !== 'object') return null;
  return Object.fromEntries(Object.entries(health).map(([serviceId, entry]) => [serviceId,
    typeof entry?.lastError === 'string' ? { ...entry, lastError: redact(entry.lastError) } : entry]));
}

function sanitizeError(error, serviceId) {
  const message = redact(error.message || 'Unknown error');
  return { harvester: serviceId, message, type: error.name || 'Error' };
}

/** HTTP parsing and presentation for semantic harvester operations. */
export function createHarvestRouter({ harvesterService, principalResolver, requestIds, deadline,
  timeoutPolicy, healthReport = async () => null, logger = console }) {
  if (typeof harvesterService?.describeFailure !== 'function' || !principalResolver?.resolve || !requestIds?.next || !deadline?.run || typeof timeoutPolicy !== 'function') {
    throw new TypeError('createHarvestRouter requires harvesterService (with describeFailure), principalResolver, requestIds, deadline and timeoutPolicy');
  }
  const router = express.Router();
  const username = (req) => req.query.user || req.body?.user || principalResolver.resolve();
  const available = () => harvesterService.listHarvesters().map(h => h.serviceId);

  router.get('/', asyncHandler(async (_req, res) => {
    const statuses = Object.fromEntries(harvesterService.getAllStatuses().map(status => [status.serviceId, status]));
    let health = null;
    try {
      health = redactHealth(await healthReport());
    } catch (error) {
      logger.warn?.('harvest.health_report_failed', { error: error.message });
    }
    return res.json({ ok: true,
      harvesters: harvesterService.listHarvesters().map(h => ({ ...h, status: statuses[h.serviceId] })),
      health,
      usage: 'GET /harvest/:serviceId or POST /harvest/:serviceId with options' });
  }));
  router.get('/status/:serviceId', (req, res) => {
    const { serviceId } = req.params;
    if (!harvesterService.has(serviceId)) return res.status(404).json({ ok: false,
      error: `Unknown harvester: ${serviceId}`, available: available() });
    return res.status(200).json({ ok: true, ...harvesterService.getStatus(serviceId) });
  });

  const run = asyncHandler(async (req, res) => {
    const options = { ...req.query, ...req.body };
    delete options.user;
    const { serviceId } = req.params;
    const requestId = requestIds.next();
    if (!harvesterService.has(serviceId)) return res.status(404).json({ ok: false,
      error: `Unknown harvester: ${serviceId}`, available: available(), requestId });
    logger.info?.('harvest.request', { serviceId, username: username(req), requestId, method: req.method });
    try {
      const timeoutMs = timeoutPolicy(serviceId);
      const result = await deadline.run(harvesterService.harvest(serviceId, username(req), options), {
        timeoutMs, message: `Timeout: ${serviceId} exceeded ${timeoutMs}ms limit`,
      });
      const failure = harvesterService.describeFailure(result);
      if (failure) {
        const message = redact(failure);
        logger.warn?.('harvest.failed', { serviceId, requestId, message });
        return res.status(502).json({ ok: false, harvester: serviceId, message, data: redactFailedResult(result), requestId });
      }
      logger.info?.('harvest.response', { serviceId, requestId, result });
      return res.status(200).json({ ok: true, harvester: serviceId, data: result, requestId });
    } catch (error) {
      logger.error?.('harvest.error', { serviceId, requestId, error: error.message });
      const status = error.message?.includes('Timeout') ? 504
        : error.message?.includes('cooldown') ? 503 : error.response?.status === 429 ? 429 : 500;
      return res.status(status).json({ ok: false, ...sanitizeError(error, serviceId), requestId });
    }
  });
  router.get('/:serviceId', run);
  router.post('/:serviceId', run);
  return router;
}

export default createHarvestRouter;
