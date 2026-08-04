import { Router, json, raw, text } from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import {
  schoolCalcArtifactHandler,
  schoolCalcCatalogHandler,
  schoolCalcDeliveryRequestsHandler,
  schoolCalcEnrollHandler,
  schoolCalcFollowUpResolveHandler,
  schoolCalcIdentifyHandler,
  schoolCalcLearnerRosterHandler,
  schoolCalcObserveHandler,
  schoolCalcProgressHandler,
  schoolCalcRemediationActionHandler,
  schoolCalcRemediationListHandler,
  schoolCalcRemediationSessionHandler,
  schoolCalcResultImportHandler,
  schoolCalcSyncHandler,
} from '../handlers/schoolcalc/index.mjs';

const binaryBody = raw({
  type: ['application/octet-stream', 'application/vnd.daylight.schoolcalc.*'],
  limit: '128kb',
});

/** Create the authenticated product-oriented SchoolCalc HTTP surface. */
export function createSchoolCalcRouter({
  container,
  authenticateIngress,
  relayIdFromRequest = (req) => req.schoolCalcIngress?.id ?? null,
} = {}) {
  if (!container) throw new Error('createSchoolCalcRouter requires container');
  if (typeof authenticateIngress !== 'function') throw new Error('createSchoolCalcRouter requires authenticateIngress middleware');
  if (typeof relayIdFromRequest !== 'function') throw new Error('createSchoolCalcRouter requires relayIdFromRequest');

  const router = Router();
  router.use(authenticateIngress);
  router.post('/devices/enroll', json({ limit: '16kb' }), asyncHandler(schoolCalcEnrollHandler({ container })));
  router.post('/devices/identify', binaryBody, asyncHandler(schoolCalcIdentifyHandler({ container })));
  router.post('/devices/:deviceId/observe', binaryBody, asyncHandler(schoolCalcObserveHandler({ container, relayIdFromRequest })));
  router.get('/devices/:deviceId/learners', asyncHandler(schoolCalcLearnerRosterHandler({ container })));
  router.get('/devices/:deviceId/progress', asyncHandler(schoolCalcProgressHandler({ container })));
  router.post('/devices/:deviceId/follow-ups/:actionKey/resolve', json({ limit: '4kb' }),
    asyncHandler(schoolCalcFollowUpResolveHandler({ container })));
  router.get('/devices/:deviceId/catalog', asyncHandler(schoolCalcCatalogHandler({ container })));
  router.post('/devices/:deviceId/requests', binaryBody, asyncHandler(schoolCalcDeliveryRequestsHandler({ container })));
  router.get('/artifacts/:artifactId', asyncHandler(schoolCalcArtifactHandler({ container })));
  router.post('/results/import',
    raw({ type: ['application/octet-stream', 'application/vnd.daylight.schoolcalc.result'], limit: '64kb' }),
    text({ type: 'text/plain', limit: '64kb' }),
    asyncHandler(schoolCalcResultImportHandler({ container })));
  router.post('/devices/:deviceId/sync', json({ limit: '256kb' }), asyncHandler(schoolCalcSyncHandler({ container, relayIdFromRequest })));
  router.get('/devices/:deviceId/remediation', asyncHandler(schoolCalcRemediationListHandler({ container })));
  router.get('/devices/:deviceId/remediation/:sessionId', asyncHandler(schoolCalcRemediationSessionHandler({ container })));
  router.post('/devices/:deviceId/remediation/:sessionId/actions', json({ limit: '16kb' }), asyncHandler(schoolCalcRemediationActionHandler({ container })));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createSchoolCalcRouter;
