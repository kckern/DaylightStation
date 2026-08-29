import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const callerId = req => req.user?.sub || req.user?.id || null;
const required = value => typeof value === 'string' && value.length > 0;

export function createHomelineRouter({ leaseService, canCall = () => false } = {}) {
  if (!leaseService) throw new Error('createHomelineRouter requires leaseService');
  const router = express.Router();

  const requireCaller = (req, res, next) => {
    if (!callerId(req)) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
    if (!canCall(req)) return res.status(403).json({ ok: false, code: 'CALL_FORBIDDEN', error: 'Call permission required' });
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
    const result = leaseService.joinActive({
      deviceId: req.params.deviceId,
      declaredDeviceId: req.get('X-Daylight-Device'),
      isLocal: req.isLocal === true,
    });
    if (result.kind === 'forbidden') return res.status(403).json({ ok: false, code: 'DEVICE_ID_MISMATCH' });
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
