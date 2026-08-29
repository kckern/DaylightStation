/**
 * Thermal printer HTTP API. Printer selection, job construction, dispatch,
 * and outcome interpretation belong to the injected application capability.
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

function sendResult(res, result) {
  if (result?.kind === 'not_found') {
    return res.status(404).json({ success: false, error: result.error });
  }
  return res.json(result);
}

function rejectUnknownLocation(printerService, location, res) {
  const error = printerService.locationError(location);
  if (!error) return false;
  sendResult(res, error);
  return true;
}

export function createPrinterRouter({ printerService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      message: 'Thermal Printer API',
      status: 'success',
      printers: printerService.list(),
      endpoints: {
        'GET /ping{/:location}': 'TCP handshake probe (no bytes written)',
        'GET /status{/:location}': 'ESC/POS status query',
        'POST /text{/:location}': 'Print text',
        'POST /image{/:location}': 'Print image from path',
        'POST /receipt{/:location}': 'Print receipt-style document',
        'POST /table{/:location}': 'Print ASCII table',
        'POST /print{/:location}': 'Print a custom job object',
        'GET /feed-button{/:location}': 'Feed button status',
        'GET /feed-button/on{/:location}': 'Enable feed button',
        'GET /feed-button/off{/:location}': 'Disable feed button',
      },
    });
  });

  router.get('/ping{/:location}', asyncHandler(async (req, res) => {
    const result = await printerService.ping(req.params.location);
    if (result?.kind === 'not_found') return sendResult(res, result);
    const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
    return res.status(statusCode).json(result);
  }));

  router.get('/status{/:location}', asyncHandler(async (req, res) => {
    sendResult(res, await printerService.status(req.params.location));
  }));

  router.post('/text{/:location}', asyncHandler(async (req, res) => {
    if (rejectUnknownLocation(printerService, req.params.location, res)) return;
    const { text, options = {} } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    return sendResult(res, await printerService.text(req.params.location, text, options));
  }));

  router.post('/image{/:location}', asyncHandler(async (req, res) => {
    if (rejectUnknownLocation(printerService, req.params.location, res)) return;
    const { path, options = {} } = req.body;
    if (!path) return res.status(400).json({ error: 'Image path is required' });
    return sendResult(res, await printerService.image(req.params.location, path, options));
  }));

  router.post('/receipt{/:location}', asyncHandler(async (req, res) => {
    if (rejectUnknownLocation(printerService, req.params.location, res)) return;
    const receiptData = req.body;
    if (!receiptData) return res.status(400).json({ error: 'Receipt data is required' });
    return sendResult(res, await printerService.receipt(req.params.location, receiptData));
  }));

  router.post('/table{/:location}', asyncHandler(async (req, res) => {
    if (rejectUnknownLocation(printerService, req.params.location, res)) return;
    const tableData = req.body;
    if (!tableData?.headers && (!tableData?.rows || tableData.rows.length === 0)) {
      return res.status(400).json({ error: 'Table must have either headers or rows with data' });
    }
    return sendResult(res, await printerService.table(req.params.location, tableData));
  }));

  router.post('/print{/:location}', asyncHandler(async (req, res) => {
    if (rejectUnknownLocation(printerService, req.params.location, res)) return;
    const printJob = req.body;
    if (!printJob?.items) return res.status(400).json({ error: 'Valid print object with items array is required' });
    return sendResult(res, await printerService.print(req.params.location, printJob));
  }));

  router.get('/feed-button{/:location}', asyncHandler(async (req, res) => {
    return sendResult(res, await printerService.feedStatus(req.params.location));
  }));

  router.get('/feed-button/on{/:location}', asyncHandler(async (req, res) => {
    return sendResult(res, await printerService.feedButton(req.params.location, true));
  }));

  router.get('/feed-button/off{/:location}', asyncHandler(async (req, res) => {
    return sendResult(res, await printerService.feedButton(req.params.location, false));
  }));

  return router;
}

export default createPrinterRouter;
