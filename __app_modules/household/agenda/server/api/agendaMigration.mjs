import express from 'express';
import { bodyFields, handler, installed, viewerFor } from '#api/utils/participantHttp.mjs';

/** No deployment/window authority is created here: an authenticated host must submit the reviewed digest. */
export function createAgendaMigrationRouter({
  householdId,
  migration,
  logger
}) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const route = fn => handler(logger, async (req, res) => {
    const viewer = viewerFor(req, householdId, true);
    await fn(req, res, installed(migration), viewer);
  });
  router.post('/dry-run', route(async (req, res, service, viewer) => {
    bodyFields(req.body ?? {}, []);
    res.json(await service.planConfigured({
      viewer
    }));
  }));
  router.post('/apply', route(async (req, res, service, viewer) => {
    const {
      reviewedManifest,
      reviewDigest,
      expectedSourceHashes
    } = bodyFields(req.body, ['reviewedManifest', 'reviewDigest', 'expectedSourceHashes']);
    if (reviewDigest !== reviewedManifest?.digest) throw Object.assign(Error('Explicit reviewed digest required'), {
      code: 'invalid_manifest'
    });
    res.json(await service.applyMigration({
      reviewedManifest,
      expectedSourceHashes,
      viewer
    }));
  }));
  router.post('/backout-preview', route(async (req, res, service, viewer) => {
    const {
      reviewedManifest,
      reviewDigest,
      planId
    } = bodyFields(req.body, ['reviewedManifest', 'reviewDigest', 'planId']);
    if (reviewDigest !== reviewedManifest?.digest) throw Object.assign(Error('Explicit reviewed migration digest required'), {
      code: 'invalid_manifest'
    });
    res.json(await service.previewBackout({
      reviewedManifest,
      planId,
      viewer
    }));
  }));
  router.post('/backout', route(async (req, res, service, viewer) => {
    const {
      reviewedManifest,
      reviewDigest,
      planId,
      reviewedBackout,
      backoutDigest
    } = bodyFields(req.body, ['reviewedManifest', 'reviewDigest', 'planId', 'reviewedBackout', 'backoutDigest']);
    if (reviewDigest !== reviewedManifest?.digest) throw Object.assign(Error('Explicit reviewed digest required'), {
      code: 'invalid_manifest'
    });
    res.json(await service.backoutMigration({
      reviewedManifest,
      planId,
      reviewedBackout,
      backoutDigest,
      viewer
    }));
  }));
  return router;
}
