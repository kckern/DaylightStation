/**
 * Printer Router
 *
 * API endpoints for thermal printer control:
 * - Ping and status
 * - Text, image, receipt, table printing
 * - Feed button control
 *
 * @module api/routers
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create printer router
 * @param {Object} config
 * @param {import('../../2_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs').ThermalPrinterAdapter} config.printerAdapter
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createPrinterRouter(config) {
  const router = express.Router();
  const { printerAdapter, logger = console } = config;

  // ============================================================================
  // Info & Status Endpoints
  // ============================================================================

  /**
   * GET /printer
   * API help message
   */
  router.get('/', (req, res) => {
    res.json({
      message: 'Thermal Printer API',
      status: 'success',
      endpoints: {
        'GET /': 'This help message',
        'GET /ping': 'Check if printer is reachable (TCP ping)',
        'GET /status': 'Get printer status',
        'POST /text': 'Print text with optional formatting',
        'POST /image': 'Print image from path',
        'POST /receipt': 'Print receipt-style document',
        'POST /table': 'Print ASCII table',
        'POST /print': 'Print custom print job object',
        'GET /feed-button': 'Get feed button status',
        'GET /feed-button/on': 'Enable the printer feed button',
        'GET /feed-button/off': 'Disable the printer feed button'
      }
    });
  });

  /**
   * GET /printer/ping
   * Check if printer is reachable
   */
  router.get('/ping', asyncHandler(async (req, res) => {
    const result = await printerAdapter.ping();
    const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
    res.status(statusCode).json(result);
  }));

  /**
   * GET /printer/status
   * Get printer status
   */
  router.get('/status', asyncHandler(async (req, res) => {
    const result = await printerAdapter.getStatus();
    res.json(result);
  }));

  // ============================================================================
  // Printing Endpoints
  // ============================================================================

  /**
   * POST /printer/text
   * Print simple text
   */
  router.post('/text', asyncHandler(async (req, res) => {
    const { text, options = {} } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const printJob = printerAdapter.createTextPrint(text, options);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Text printed successfully' : 'Print failed',
      printJob
    });
  }));

  /**
   * POST /printer/image
   * Print image from path
   */
  router.post('/image', asyncHandler(async (req, res) => {
    const { path, options = {} } = req.body;

    if (!path) {
      return res.status(400).json({ error: 'Image path is required' });
    }

    const printJob = printerAdapter.createImagePrint(path, options);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Image printed successfully' : 'Print failed',
      printJob
    });
  }));

  /**
   * POST /printer/receipt
   * Print receipt-style document
   */
  router.post('/receipt', asyncHandler(async (req, res) => {
    const receiptData = req.body;

    if (!receiptData) {
      return res.status(400).json({ error: 'Receipt data is required' });
    }

    const printJob = printerAdapter.createReceiptPrint(receiptData);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Receipt printed successfully' : 'Print failed',
      printJob
    });
  }));

  /**
   * POST /printer/table
   * Print ASCII table
   */
  router.post('/table', asyncHandler(async (req, res) => {
    const tableData = req.body;

    if (!tableData?.headers && (!tableData?.rows || tableData.rows.length === 0)) {
      return res.status(400).json({
        error: 'Table must have either headers or rows with data'
      });
    }

    const printJob = printerAdapter.createTablePrint(tableData);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Table printed successfully' : 'Print failed',
      printJob
    });
  }));

  /**
   * POST /printer/print
   * Print custom job object
   */
  router.post('/print', asyncHandler(async (req, res) => {
    const printJob = req.body;

    if (!printJob?.items) {
      return res.status(400).json({ error: 'Valid print object with items array is required' });
    }

    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Print job completed successfully' : 'Print failed',
      printJob
    });
  }));

  // ============================================================================
  // Feed Button Control
  // ============================================================================

  /**
   * GET /printer/feed-button
   * Get feed button status
   */
  router.get('/feed-button', asyncHandler(async (req, res) => {
    const status = await printerAdapter.getStatus();
    res.json({
      success: status.success,
      feedButtonEnabled: status.feedButtonEnabled,
      note: 'Feed button status cannot be queried directly from most ESC/POS printers',
      endpoints: {
        'GET /feed-button/on': 'Enable the printer feed button',
        'GET /feed-button/off': 'Disable the printer feed button'
      }
    });
  }));

  /**
   * GET /printer/feed-button/on
   * Enable feed button
   */
  router.get('/feed-button/on', asyncHandler(async (req, res) => {
    const printJob = printerAdapter.setFeedButton(true);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Feed button enabled successfully' : 'Feed button enable failed',
      enabled: true
    });
  }));

  /**
   * GET /printer/feed-button/off
   * Disable feed button
   */
  router.get('/feed-button/off', asyncHandler(async (req, res) => {
    const printJob = printerAdapter.setFeedButton(false);
    const success = await printerAdapter.print(printJob);

    res.json({
      success,
      message: success ? 'Feed button disabled successfully' : 'Feed button disable failed',
      enabled: false
    });
  }));

  return router;
}

export default createPrinterRouter;
