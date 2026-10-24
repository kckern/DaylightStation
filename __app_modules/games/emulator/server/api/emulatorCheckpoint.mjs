import express from 'express';
import { safeSegment } from '#system/utils/safePathSegment.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const STATUS = { ECHECKPOINTINVALID: 400, ESAVEOWNER: 403, ENOENT: 404,
  ECHECKPOINTCONFLICT: 409, ECHECKPOINTCOMPAT: 409, ECHECKPOINTREQUIRED: 409,
  ECHECKPOINTCORRUPT: 422, ECHECKPOINTTOOLARGE: 413 };
function decode(value) {
  if (value == null) return value;
  if (typeof value !== 'string') throw Object.assign(new Error('Save data must be base64'), { code: 'ECHECKPOINTINVALID' });
  if (value.length > Math.ceil(MAX_BYTES / 3) * 4) throw Object.assign(new Error('Save data is too large'), { code: 'ECHECKPOINTTOOLARGE' });
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_BYTES) throw Object.assign(new Error('Save data is too large'), { code: 'ECHECKPOINTTOOLARGE' });
  if (!bytes.length || bytes.toString('base64') !== value) throw Object.assign(new Error('Invalid save encoding'), { code: 'ECHECKPOINTINVALID' });
  return bytes;
}
function encode(checkpoint) {
  if (!checkpoint) return null;
  return { ...checkpoint, snapshot: checkpoint.snapshot?.toString('base64') ?? null,
    battery: checkpoint.battery?.toString('base64') ?? null };
}

/** Protected progress transport. Bodies are bounded, artifacts remain opaque. */
export function createEmulatorCheckpointRouter({ service, logger }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '24mb', strict: true }));
  router.use('/:system/:gameId', (req, res, next) => {
    try {
      req.checkpointKey = { system: safeSegment(req.params.system), gameId: safeSegment(req.params.gameId),
        user: safeSegment(String(req.query.user ?? '')).toLowerCase() };
      next();
    } catch { res.status(400).json({ error: 'Invalid game or player', code: 'ECHECKPOINTINVALID' }); }
  });
  const route = (operation) => async (req, res) => {
    try { await operation(req, res); }
    catch (err) {
      const status = STATUS[err.code] ?? 500;
      logger[status >= 500 ? 'error' : 'warn']('emulator.checkpoint.failed', { ...req.checkpointKey, code: err.code, error: err.message });
      res.status(status).json({ error: status >= 500 ? 'Could not read or save progress' : err.message,
        code: status >= 500 ? 'ECHECKPOINTUNAVAILABLE' : err.code });
    }
  };
  router.get('/:system/:gameId', route(async (req, res) => {
    const result = await service.read(req.checkpointKey, { variant: req.query.variant });
    res.json({ ...result, head: encode(result.head) });
  }));
  router.get('/:system/:gameId/history', route(async (req, res) => {
    res.json({ checkpoints: await service.history(req.checkpointKey) });
  }));
  router.get('/:system/:gameId/revision/:revision', route(async (req, res) => {
    const revision = safeSegment(req.params.revision);
    res.json({ head: encode(await service.revision(req.checkpointKey, revision)) });
  }));
  const write = (operation, includeBytes = true) => route(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Checkpoint metadata is required', code: 'ECHECKPOINTINVALID' });
    }
    const payload = { expectedRevision: body.expectedRevision, captureId: body.captureId,
      sessionId: body.sessionId, sequence: body.sequence, provenance: body.provenance,
      ...(operation === 'recover' ? { sourceRevision: body.sourceRevision } : {}),
      ...(includeBytes ? { snapshot: decode(body.snapshot), battery: decode(body.battery) } : {}),
    };
    const head = await service[operation](req.checkpointKey, payload);
    logger.info('emulator.checkpoint.committed', { ...req.checkpointKey, revision: head.revision,
      captureId: head.captureId, kind: head.kind, snapshotHash: head.artifacts.snapshot?.hash ?? null });
    res.json({ head: encode(head) });
  });
  router.put('/:system/:gameId', write('commit'));
  router.post('/:system/:gameId/reset', write('reset', false));
  router.post('/:system/:gameId/import', write('import'));
  router.post('/:system/:gameId/recover', write('recover', false));
  router.use((err, _req, res, next) => {
    if (!['entity.too.large', 'entity.parse.failed'].includes(err.type)) return next(err);
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid checkpoint request', code: 'ECHECKPOINTINVALID' });
  });
  return router;
}
