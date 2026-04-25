/**
 * NFC Router — maps GET /:readerId/:tagUid to NfcService.handleScan.
 * @module api/v1/routers/nfc
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS_BY_CODE = {
  READER_NOT_FOUND: 404,
  TAG_NOT_REGISTERED: 404,
  AUTH_FAILED: 401,
  UNKNOWN_ACTION: 400,
  INVALID_INTENT: 400,
  DISPATCH_FAILED: 502,
};

export function createNfcRouter({ nfcService, logger = console }) {
  const router = express.Router();

  router.get('/:readerId/:tagUid', asyncHandler(async (req, res) => {
    const { readerId, tagUid } = req.params;
    const { token, dryRun } = req.query;
    const options = { token };
    if (dryRun === '1' || dryRun === 'true') options.dryRun = true;

    logger.debug?.('nfc.router.scan', { readerId, tagUid, dryRun: !!options.dryRun });

    const result = await nfcService.handleScan(readerId, tagUid, options);

    if (result.ok) return res.status(200).json(result);

    const status = STATUS_BY_CODE[result.code] || 500;
    return res.status(status).json(result);
  }));

  return router;
}

export default createNfcRouter;
