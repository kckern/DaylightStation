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
  operations,
  authenticateIngress,
  relayIdFromRequest = (req) => req.schoolCalcIngress?.id ?? null,
} = {}) {
  if (!operations) throw new Error('createSchoolCalcRouter requires operations');
  if (typeof authenticateIngress !== 'function') throw new Error('createSchoolCalcRouter requires authenticateIngress middleware');
  if (typeof relayIdFromRequest !== 'function') throw new Error('createSchoolCalcRouter requires relayIdFromRequest');

  const router = Router();
  router.use(authenticateIngress);
  router.post('/devices/enroll', json({ limit: '16kb' }), asyncHandler(schoolCalcEnrollHandler({ operations })));
  router.post('/devices/identify', binaryBody, asyncHandler(schoolCalcIdentifyHandler({ operations })));
  router.post('/devices/:deviceId/observe', binaryBody, asyncHandler(schoolCalcObserveHandler({ operations, relayIdFromRequest })));
  router.get('/devices/:deviceId/learners', asyncHandler(schoolCalcLearnerRosterHandler({ operations })));
  router.get('/devices/:deviceId/progress', asyncHandler(schoolCalcProgressHandler({ operations })));
  router.post('/devices/:deviceId/follow-ups/:actionKey/resolve', json({ limit: '4kb' }),
    asyncHandler(schoolCalcFollowUpResolveHandler({ operations })));
  router.get('/devices/:deviceId/catalog', asyncHandler(schoolCalcCatalogHandler({ operations })));
  router.post('/devices/:deviceId/requests', binaryBody, asyncHandler(schoolCalcDeliveryRequestsHandler({ operations })));
  router.get('/artifacts/:artifactId', asyncHandler(schoolCalcArtifactHandler({ operations })));
  router.post('/results/import',
    raw({ type: ['application/octet-stream', 'application/vnd.daylight.schoolcalc.result'], limit: '64kb' }),
    text({ type: 'text/plain', limit: '64kb' }),
    asyncHandler(schoolCalcResultImportHandler({ operations })));
  router.post('/devices/:deviceId/sync', json({ limit: '256kb' }), asyncHandler(schoolCalcSyncHandler({ operations, relayIdFromRequest })));
  router.get('/devices/:deviceId/remediation', asyncHandler(schoolCalcRemediationListHandler({ operations })));
  router.get('/devices/:deviceId/remediation/:sessionId', asyncHandler(schoolCalcRemediationSessionHandler({ operations })));
  router.post('/devices/:deviceId/remediation/:sessionId/actions', json({ limit: '16kb' }), asyncHandler(schoolCalcRemediationActionHandler({ operations })));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createSchoolCalcRouter;
