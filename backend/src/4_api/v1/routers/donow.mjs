/**
 * DoNow Router — the household "start this, there, now" facade (spec §7).
 * @module api/v1/routers/donow
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {Object} config.service - DoNowService (`dispatch`, `listSurfaces`).
 * @param {Object} config.approvals - DoNowApprovals (`listPending`, `approve`, `deny`).
 * @param {(input: { expectedToken: string|null, providedToken: string|null }) => { ok: boolean, code?: string }} config.authenticateApproval
 *   - Application-owned authentication policy, injected by composition.
 * @param {string|null} [config.expectedToken] - the DoNow `approvalsToken`
 *   secret, injected by composition (this layer does not know where it is
 *   stored). Open (no auth) when falsy — the exact posture the trigger
 *   router's `authenticate` guard already takes. Callers present it as
 *   `Authorization: Bearer <token>`, or in the JSON body; see `readToken`.
 * @param {Object} [config.logger]
 */
export function createDoNowRouter({
  service, approvals, authenticateApproval, expectedToken = null, logger = console,
} = {}) {
  if (typeof authenticateApproval !== 'function') {
    throw new Error('createDoNowRouter: authenticateApproval required');
  }
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
    const auth = authenticateApproval({ expectedToken, providedToken: readToken(req, logger) });
    if (!auth.ok) return res.status(401).json({ ok: false, code: auth.code });

    const result = await approvals.approve({ id: req.params.id });
    return res.json(result);
  }));

  router.post('/approvals/:id/deny', express.json(), asyncHandler(async (req, res) => {
    const auth = authenticateApproval({ expectedToken, providedToken: readToken(req, logger) });
    if (!auth.ok) return res.status(401).json({ ok: false, code: auth.code });

    const result = await approvals.deny({ id: req.params.id });
    return res.json(result);
  }));

  return router;
}

/**
 * Prefer header, then body. `?token=` is still accepted so HA's existing
 * callbacks keep working, but it lands in access logs and in notification URLs
 * — it is removed once the HA automation has been updated and the deprecation
 * warn has gone quiet.
 */
function readToken(req, logger) {
  const header = req.get?.('authorization');
  // RFC 7235: the auth scheme is case-INSENSITIVE. Home Assistant is the real
  // caller here, and a lowercase `bearer` falling through to a 401 would break
  // parental approvals in a way that looks like a bad token.
  const bearer = /^bearer\s+(.+)$/i.exec(header ?? '');
  if (bearer) return bearer[1].trim();
  if (req.body?.token) return req.body.token;
  if (req.query?.token) {
    logger?.warn?.('donow.approvals.token.query_deprecated', { path: req.path });
    return req.query.token;
  }
  return null;
}

export default createDoNowRouter;
