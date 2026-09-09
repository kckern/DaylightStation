import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Who is calling.
 *
 * Home Line is a tin can on a string: two ends, no user provisioning, no
 * sign-in, no identification. It is reachable only from the house network or
 * over the VPN, and THAT is the access boundary — not anything in this file.
 * A caller therefore needs an identity only so the lease has an owner: it is
 * what stops a stray tab from ending a call it did not place, and what lets a
 * phone that refreshed mid-call resume its own.
 *
 * `trusted-local-network` is the same anonymous identity the state-gates
 * ingress adapter already uses for an unauthenticated local request. A JWT is
 * still honoured if one happens to be present, so an authenticated household
 * member keeps a distinct owner, but nobody is ever asked for one.
 */
const callerId = req => req.user?.sub || req.user?.id || (req.isLocal ? 'trusted-local-network' : null);
const required = value => typeof value === 'string' && value.length > 0;

/**
 * Which fleet device a request says it is.
 *
 * `X-Daylight-Device` (minted by frontend/src/lib/deviceIdentity.js) always
 * carries its provenance as a prefix. Only `fleet:<name>` — the name a rendered
 * screen took from its own served config — can name a device; `browser:` and
 * `ephemeral:` tokens are anonymous and so can never match anything. Until
 * 2026-09-08 this compared the raw header against the bare id, so the
 * living-room Shield's `browser:968748c03fe14fcc` was refused on every join
 * and no TV had ever entered a call.
 */
const FLEET_PREFIX = 'fleet:';
const declaredFleetDevice = header => (typeof header === 'string' && header.startsWith(FLEET_PREFIX)
  && header.length > FLEET_PREFIX.length) ? header.slice(FLEET_PREFIX.length) : null;

export function createHomelineRouter({ leaseService, canCall = () => true, logger = null } = {}) {
  if (!leaseService) throw new Error('createHomelineRouter requires leaseService');
  const router = express.Router();

  /**
   * The only thing that can refuse a caller now is arriving from off the
   * network — and behind the reverse proxy every request already presents a
   * private peer, so in practice this refuses nobody. It is kept as the shape
   * of the boundary, not as the boundary itself; the real one is the VPN.
   *
   * A refusal used to leave NO trace: the only backend-visible fact was an
   * HTTP status, and the caller's browser logged it as a generic
   * `api.response.error`. Reconstructing why meant reading this file.
   *
   *   query=homeline.call.denied AND _time:24h
   */
  const requireCaller = (req, res, next) => {
    if (!callerId(req)) {
      logger?.info?.('homeline.call.denied', {
        cause: 'off_network', status: 401, path: req.path, method: req.method,
        deviceId: req.body?.deviceId ?? req.params?.deviceId ?? null,
        isLocal: req.isLocal === true,
      });
      return res.status(401).json({ ok: false, code: 'NOT_ON_HOME_NETWORK', error: 'Home Line is only reachable from the home network' });
    }
    if (!canCall(req)) {
      logger?.info?.('homeline.call.denied', {
        cause: 'no_permission', status: 403, path: req.path, method: req.method,
        deviceId: req.body?.deviceId ?? req.params?.deviceId ?? null,
        callerId: callerId(req), isLocal: req.isLocal === true,
      });
      return res.status(403).json({ ok: false, code: 'CALL_FORBIDDEN', error: 'Call permission required' });
    }
    logger?.debug?.('homeline.call.authorized', { callerId: callerId(req), path: req.path });
    return next();
  };

  router.post('/calls', requireCaller, asyncHandler(async (req, res) => {
    const { deviceId, attemptId, phonePeerId } = req.body || {};
    if (![deviceId, attemptId, phonePeerId].every(required)) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', error: 'deviceId, attemptId, and phonePeerId are required' });
    }
    const result = await leaseService.reserve({ deviceId, attemptId, phonePeerId, callerId: callerId(req) });
    if (result.kind === 'not_found') return res.status(404).json({ ok: false, code: 'DEVICE_NOT_FOUND', error: 'Device not found' });
    if (result.kind === 'busy') return res.status(409).json({ ok: false, code: 'DEVICE_BUSY', error: 'Device is already in a call' });
    return res.status(201).json(result.body);
  }));

  router.post('/calls/:callId/wake', requireCaller, asyncHandler(async (req, res) => {
    const result = await leaseService.wake(req.params.callId, callerId(req));
    if (result.kind === 'not_found') return res.status(404).json({ ok: false, code: 'CALL_NOT_FOUND' });
    if (result.kind === 'in_progress') return res.status(409).json({ ok: false, code: 'CALL_OPERATION_IN_PROGRESS' });
    if (result.kind === 'wake_exhausted') return res.status(409).json({ ok: false, code: 'WAKE_ALREADY_DISPATCHED' });
    return res.status(result.kind === 'ok' ? 200 : 502).json(result.body);
  }));

  router.post('/devices/:deviceId/join-active', (req, res) => {
    const declared = req.get('X-Daylight-Device');
    const result = leaseService.joinActive({
      deviceId: req.params.deviceId,
      declaredDeviceId: declaredFleetDevice(declared),
      isLocal: req.isLocal === true,
    });
    if (result.kind === 'forbidden') {
      // The TV is the one client whose browser log is hardest to reach, and a
      // refused join used to be recorded nowhere else.
      //
      //   query=homeline.join.denied AND _time:24h
      logger?.info?.('homeline.join.denied', {
        deviceId: req.params.deviceId, declared: declared ?? null, isLocal: req.isLocal === true, status: 403,
      });
      return res.status(403).json({ ok: false, code: 'DEVICE_ID_MISMATCH' });
    }
    if (result.kind === 'empty') return res.status(204).end();
    return res.json(result.body);
  });

  router.post('/calls/:callId/resume', requireCaller, (req, res) => {
    const result = leaseService.resume(req.params.callId, callerId(req));
    return result.kind === 'ok' ? res.json(result.body) : res.status(404).json({ ok: false, code: 'CALL_NOT_FOUND' });
  });

  router.post('/calls/:callId/recover', requireCaller, asyncHandler(async (req, res) => {
    const result = await leaseService.recover(req.params.callId, callerId(req), req.body?.level,
      { confirmed: req.body?.confirmed === true });
    if (result.kind === 'not_found') return res.status(404).json({ ok: false, code: 'CALL_NOT_FOUND' });
    if (result.kind === 'invalid') return res.status(400).json({ ok: false, code: 'INVALID_RECOVERY_LEVEL' });
    if (result.kind === 'confirmation_required') return res.status(409).json({ ok: false, code: 'HARD_RECOVERY_CONFIRMATION_REQUIRED' });
    if (result.kind === 'in_progress') return res.status(409).json({ ok: false, code: 'CALL_OPERATION_IN_PROGRESS' });
    if (result.kind === 'soft_exhausted') return res.status(409).json({ ok: false, code: 'SOFT_RECOVERY_EXHAUSTED' });
    if (result.kind === 'exhausted') return res.status(409).json({ ok: false, code: 'HARD_RECOVERY_EXHAUSTED' });
    return res.status(result.kind === 'ok' ? 200 : 502).json(result.body);
  }));

  router.post('/calls/:callId/end', requireCaller, asyncHandler(async (req, res) => {
    const result = await leaseService.end(req.params.callId, callerId(req), req.body?.reason || 'ended');
    return result.kind === 'ok' ? res.json(result.body) : res.status(404).json({ ok: false, code: 'CALL_NOT_FOUND' });
  }));

  return router;
}

export default createHomelineRouter;
