/**
 * Printer Router
 *
 * API endpoints for thermal printer control, keyed by location:
 *   /printer/<action>/:location?
 *
 * `:location` is optional and falls back to the default printer configured
 * in the registry.
 *
 * @module api/routers
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Resolve the adapter for a request. Throws with a 404-shaped message
 * when the location is unknown.
 * @param {import('#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs').ThermalPrinterRegistry} registry
 * @param {express.Request} req
 */
function resolveAdapter(registry, req) {
  const name = req.params.location;
  try {
    return registry.resolve(name);
  } catch (err) {
    const e = new Error(err.message);
    e.statusCode = 404;
    throw e;
  }
}

/**
 * Create printer router
 * @param {Object} config
 * @param {import('#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs').ThermalPrinterRegistry} config.printerRegistry
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createPrinterRouter(config) {
  const router = express.Router();
  const { printerRegistry, logger = console } = config;

  // GET /printer — list configured printers
  router.get('/', (req, res) => {
    res.json({
      message: 'Thermal Printer API',
      status: 'success',
      printers: printerRegistry.list(),
      endpoints: {
        'GET /ping/:location?': 'TCP handshake probe (no bytes written)',
        'GET /status/:location?': 'ESC/POS status query',
        'POST /text/:location?': 'Print text',
        'POST /image/:location?': 'Print image from path',
        'POST /receipt/:location?': 'Print receipt-style document',
        'POST /table/:location?': 'Print ASCII table',
        'POST /print/:location?': 'Print a custom job object',
        'GET /feed-button/:location?': 'Feed button status',
        'GET /feed-button/on/:location?': 'Enable feed button',
        'GET /feed-button/off/:location?': 'Disable feed button',
      },
    });
  });

  router.get('/ping/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const result = await adapter.ping();
    const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
    res.status(statusCode).json(result);
  }));

  router.get('/status/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    res.json(await adapter.getStatus());
  }));

  router.post('/text/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const { text, options = {} } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const printJob = adapter.createTextPrint(text, options);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Text printed successfully' : 'Print failed', printJob });
  }));

  router.post('/image/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const { path, options = {} } = req.body;
    if (!path) return res.status(400).json({ error: 'Image path is required' });
    const printJob = adapter.createImagePrint(path, options);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Image printed successfully' : 'Print failed', printJob });
  }));

  router.post('/receipt/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const receiptData = req.body;
    if (!receiptData) return res.status(400).json({ error: 'Receipt data is required' });
    const printJob = adapter.createReceiptPrint(receiptData);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Receipt printed successfully' : 'Print failed', printJob });
  }));

  router.post('/table/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const tableData = req.body;
    if (!tableData?.headers && (!tableData?.rows || tableData.rows.length === 0)) {
      return res.status(400).json({ error: 'Table must have either headers or rows with data' });
    }
    const printJob = adapter.createTablePrint(tableData);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Table printed successfully' : 'Print failed', printJob });
  }));

  router.post('/print/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = req.body;
    if (!printJob?.items) return res.status(400).json({ error: 'Valid print object with items array is required' });
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Print job completed successfully' : 'Print failed', printJob });
  }));

  router.get('/feed-button/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const status = await adapter.getStatus();
    res.json({
      success: status.success,
      feedButtonEnabled: status.feedButtonEnabled,
      note: 'Feed button status cannot be queried directly from most ESC/POS printers',
    });
  }));

  router.get('/feed-button/on/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = adapter.setFeedButton(true);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Feed button enabled successfully' : 'Feed button enable failed', enabled: true });
  }));

  router.get('/feed-button/off/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = adapter.setFeedButton(false);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Feed button disabled successfully' : 'Feed button disable failed', enabled: false });
  }));

  return router;
}

export default createPrinterRouter;
