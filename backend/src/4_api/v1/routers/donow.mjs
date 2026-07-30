/**
 * DoNow Router — the household "start this, there, now" facade (spec §7).
 * @module api/v1/routers/donow
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { authenticate } from '#apps/trigger/guards/authenticate.mjs';

/**
 * @param {Object} config
 * @param {Object} config.service - DoNowService (`dispatch`, `listSurfaces`).
 * @param {Object} config.approvals - DoNowApprovals (`listPending`, `approve`, `deny`).
 * @param {string|null} [config.expectedToken] - `donow.approvalsToken`; open (no auth) when falsy —
 *   the exact posture the trigger router's `authenticate` guard already takes.
 * @param {Object} [config.logger]
 */
export function createDoNowRouter({
  service, approvals, expectedToken = null, logger = console,
} = {}) {
  const router = express.Router();

  router.post('/dispatch', express.json(), asyncHandler(async (req, res) => {
    const { surface, action, learnerId, ref, force, programId } = req.body || {};
    logger.debug?.('donow.router.dispatch', { surface, learnerId, ref });
    const result = await service.dispatch({
      surface, action, learnerId, ref, force, programId, requestedBy: 'api',
    });
    res.json(result);
  }));

  router.get('/surfaces', asyncHandler(async (req, res) => {
    res.json({ surfaces: service.listSurfaces() });
  }));

  router.get('/approvals', asyncHandler(async (req, res) => {
    const pending = await approvals.listPending();
    res.json({ pending });
  }));

  router.post('/approvals/:id/approve', express.json(), asyncHandler(async (req, res) => {
    const auth = authenticate({ expectedToken, providedToken: readToken(req) });
    if (!auth.ok) return res.status(401).json({ ok: false, code: auth.code });

    const result = await approvals.approve({ id: req.params.id });
    return res.json(result);
  }));

  router.post('/approvals/:id/deny', express.json(), asyncHandler(async (req, res) => {
    const auth = authenticate({ expectedToken, providedToken: readToken(req) });
    if (!auth.ok) return res.status(401).json({ ok: false, code: auth.code });

    const result = await approvals.deny({ id: req.params.id });
    return res.json(result);
  }));

  return router;
}

function readToken(req) {
  return req.query?.token || req.body?.token;
}

export default createDoNowRouter;
