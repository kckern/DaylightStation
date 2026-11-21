import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const SUPPORTED_DOCUMENTS = new Set(['goals', 'program-state']);

function isDocumentObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRequest(req, res, isKnownUser) {
  const { username, document } = req.params;
  if (!username || /[\/\\.]/.test(username)) {
    res.status(400).json({ error: 'Invalid household member', code: 'INVALID_MEMBER' });
    return null;
  }
  if (!isKnownUser(username)) {
    res.status(404).json({ error: 'Unknown household member', code: 'UNKNOWN_MEMBER' });
    return null;
  }
  if (!SUPPORTED_DOCUMENTS.has(document)) {
    res.status(404).json({ error: 'Unsupported Health Coach config document', code: 'UNSUPPORTED_DOCUMENT' });
    return null;
  }
  return { username, document };
}

export function createHealthCoachAdminRouter({ workspaceRepository, isKnownUser, logger = console } = {}) {
  if (typeof workspaceRepository?.readAdminConfigDocument !== 'function'
    || typeof workspaceRepository?.saveAdminConfigDocument !== 'function'
    || typeof isKnownUser !== 'function') {
    throw new TypeError('createHealthCoachAdminRouter requires workspaceRepository and isKnownUser');
  }

  const router = express.Router();
  const path = '/members/:username/config/:document';

  router.get(path, asyncHandler(async (req, res) => {
    const target = validateRequest(req, res, isKnownUser);
    if (!target) return;

    const entry = await workspaceRepository.readAdminConfigDocument(target.username, target.document);
    if (entry?.found === false) {
      return res.status(404).json({ error: 'Health Coach config document not found', code: 'NOT_FOUND' });
    }
    if (entry?.found !== true) throw new Error('Health Coach config repository returned an invalid read result');
    return res.json({ parsed: entry.value });
  }));

  router.put(path, asyncHandler(async (req, res) => {
    const target = validateRequest(req, res, isKnownUser);
    if (!target) return;

    const parsed = req.body?.parsed;
    if (!isDocumentObject(parsed)) {
      return res.status(400).json({ error: 'Config document must be an object', code: 'INVALID_DOCUMENT' });
    }

    const saved = await workspaceRepository.saveAdminConfigDocument(target.username, target.document, parsed);
    if (saved !== true) {
      logger.error?.('admin.health-coach.config.save_failed', { username: target.username, document: target.document });
      throw new Error('Failed to save Health Coach config document');
    }
    return res.json({ saved: true });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createHealthCoachAdminRouter;
