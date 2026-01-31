/**
 * Gratitude API Router
 *
 * Endpoints:
 * - GET  /api/gratitude/bootstrap - Get all gratitude data for initialization
 * - GET  /api/gratitude/options - Get all options (randomized)
 * - GET  /api/gratitude/options/:category - Get options for category
 * - POST /api/gratitude/options/:category - Add a new option
 * - GET  /api/gratitude/selections/:category - Get selections for category
 * - POST /api/gratitude/selections/:category - Add a selection
 * - DELETE /api/gratitude/selections/:category/:selectionId - Remove a selection
 * - GET  /api/gratitude/discarded/:category - Get discarded items
 * - POST /api/gratitude/discarded/:category - Discard an item
 * - POST /api/gratitude/snapshot/save - Save a snapshot
 * - GET  /api/gratitude/snapshot/list - List available snapshots
 * - POST /api/gratitude/snapshot/restore - Restore from snapshot
 * - GET  /api/gratitude/new - Broadcast custom item via WebSocket
 * - GET  /api/gratitude/users - Get household users
 *
 * @module api/routers/gratitude
 */

import express from 'express';
import { writeBinary, deleteFile } from '#system/utils/FileIO.mjs';
import { nowTs, nowTs24 } from '#system/utils/index.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create gratitude API router
 *
 * @param {Object} config
 * @param {import('#domains/gratitude/services/GratitudeService.mjs').GratitudeService} config.gratitudeService
 * @param {Object} config.configService - ConfigService for household data
 * @param {Function} config.broadcastToWebsockets - WebSocket broadcast function
 * @param {Object} [config.printerAdapter] - ThermalPrinterAdapter for card printing
 * @param {Function} [config.createPrayerCardCanvas] - Function to create prayer card canvas
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createGratitudeRouter(config) {
  const {
    gratitudeService,
    configService,
    broadcastToWebsockets,
    printerAdapter,
    createPrayerCardCanvas,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Get household ID from request
   */
  const getHouseholdId = (req) =>
    req.query.household || configService.getDefaultHouseholdId();

  /**
   * Get household timezone
   */
  const getTimezone = (householdId) =>
    configService.getHouseholdTimezone?.(householdId) || 'UTC';

  /**
   * Generate timestamp in household's timezone
   */
  const generateTimestamp = (householdId) => {
    const timezone = getTimezone(householdId);
    if (timezone && timezone !== 'UTC') {
      return new Date().toLocaleString('en-US', { timeZone: timezone });
    }
    return nowTs24();
  };

  /**
   * Validate category parameter
   */
  const validateCategory = (category) => {
    const cat = String(category || '').toLowerCase();
    return gratitudeService.isValidCategory(cat) ? cat : null;
  };

  /**
   * Resolve display name for a user
   */
  const resolveDisplayName = (userId) => {
    if (!userId) return 'Unknown';
    const profile = configService.getUserProfile?.(userId);
    return profile?.group_label
      || profile?.display_name
      || profile?.name
      || userId.charAt(0).toUpperCase() + userId.slice(1);
  };

  /**
   * Get household users from config
   */
  const getHouseholdUsers = (householdId) => {
    const usernames = configService.getHouseholdUsers?.(householdId) || [];
    return usernames.map(username => {
      const profile = configService.getUserProfile?.(username);
      return {
        id: username,
        name: profile?.display_name || profile?.name ||
          username.charAt(0).toUpperCase() + username.slice(1),
        group_label: profile?.group_label || null
      };
    });
  };

  // ===========================================================================
  // Bootstrap
  // ===========================================================================

  /**
   * GET /api/gratitude/bootstrap - Get all data for initialization
   */
  router.get('/bootstrap', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const data = await gratitudeService.bootstrap(householdId);

    // Get users from household config
    const users = getHouseholdUsers(householdId);

    res.json({
      users,
      ...data,
      _household: householdId
    });
  }));

  // ===========================================================================
  // Users
  // ===========================================================================

  /**
   * GET /api/gratitude/users - Get household users
   */
  router.get('/users', (req, res) => {
    const householdId = getHouseholdId(req);
    const users = getHouseholdUsers(householdId);
    res.json({ users, _household: householdId });
  });

  // ===========================================================================
  // Options
  // ===========================================================================

  /**
   * GET /api/gratitude/options - Get all options (randomized)
   */
  router.get('/options', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const options = await gratitudeService.getAllOptions(householdId);

    res.json({
      options: {
        gratitude: options.gratitude.map(i => i.toJSON()),
        hopes: options.hopes.map(i => i.toJSON())
      },
      _household: householdId
    });
  }));

  /**
   * GET /api/gratitude/options/:category - Get options for category
   */
  router.get('/options/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const householdId = getHouseholdId(req);
    const items = await gratitudeService.getOptions(householdId, category);

    res.json({
      items: items.map(i => i.toJSON()),
      _household: householdId
    });
  }));

  /**
   * POST /api/gratitude/options/:category - Add a new option
   */
  router.post('/options/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    const householdId = getHouseholdId(req);
    const item = await gratitudeService.addOption(householdId, category, text.trim());

    res.status(201).json({
      item: item.toJSON(),
      _household: householdId
    });
  }));

  // ===========================================================================
  // Selections
  // ===========================================================================

  /**
   * GET /api/gratitude/selections/:category - Get selections for category
   */
  router.get('/selections/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const householdId = getHouseholdId(req);
    const selections = await gratitudeService.getSelections(householdId, category);

    res.json({
      items: selections.map(s => s.toJSON()),
      _household: householdId
    });
  }));

  /**
   * POST /api/gratitude/selections/:category - Add a selection
   */
  router.post('/selections/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const { userId, item } = req.body || {};
    if (!userId || !item || typeof item.id === 'undefined') {
      return res.status(400).json({ error: 'Missing userId or item' });
    }

    try {
      const householdId = getHouseholdId(req);
      const timestamp = generateTimestamp(householdId);
      const selection = await gratitudeService.addSelection(
        householdId,
        category,
        userId,
        item,
        timestamp
      );

      res.status(201).json({
        selection: selection.toJSON(),
        _household: householdId
      });
    } catch (error) {
      if (error.message === 'Item already selected by this user') {
        return res.status(409).json({ error: error.message });
      }
      throw error;
    }
  }));

  /**
   * DELETE /api/gratitude/selections/:category/:selectionId - Remove a selection
   */
  router.delete('/selections/:category/:selectionId', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const { selectionId } = req.params;
    const householdId = getHouseholdId(req);
    const removed = await gratitudeService.removeSelection(householdId, category, selectionId);

    if (!removed) {
      return res.status(404).json({ error: 'Selection not found' });
    }

    res.json({
      removed: removed.toJSON(),
      _household: householdId
    });
  }));

  // ===========================================================================
  // Discarded
  // ===========================================================================

  /**
   * GET /api/gratitude/discarded/:category - Get discarded items
   */
  router.get('/discarded/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const householdId = getHouseholdId(req);
    const items = await gratitudeService.getDiscarded(householdId, category);

    res.json({
      items: items.map(i => i.toJSON()),
      _household: householdId
    });
  }));

  /**
   * POST /api/gratitude/discarded/:category - Discard an item
   */
  router.post('/discarded/:category', asyncHandler(async (req, res) => {
    const category = validateCategory(req.params.category);
    if (!category) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const { item } = req.body || {};
    if (!item || typeof item.id === 'undefined') {
      return res.status(400).json({ error: 'Missing item' });
    }

    const householdId = getHouseholdId(req);
    const discardedItem = await gratitudeService.discardItem(householdId, category, item);

    res.status(201).json({
      item: discardedItem.toJSON(),
      _household: householdId
    });
  }));

  // ===========================================================================
  // Snapshots
  // ===========================================================================

  /**
   * POST /api/gratitude/snapshot/save - Save a snapshot
   */
  router.post('/snapshot/save', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const timestamp = generateTimestamp(householdId);
    const result = await gratitudeService.saveSnapshot(householdId, timestamp);

    res.status(201).json({
      ...result,
      _household: householdId
    });
  }));

  /**
   * GET /api/gratitude/snapshot/list - List available snapshots
   */
  router.get('/snapshot/list', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const snapshots = await gratitudeService.listSnapshots(householdId);

    res.json({
      snapshots,
      _household: householdId
    });
  }));

  /**
   * POST /api/gratitude/snapshot/restore - Restore from snapshot
   */
  router.post('/snapshot/restore', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const { id, name } = req.body || {};
    const snapshotId = id || name?.replace(/\.(yml|yaml)$/, '');

    try {
      const result = await gratitudeService.restoreSnapshot(householdId, snapshotId);

      res.json({
        ...result,
        _household: householdId
      });
    } catch (error) {
      if (error.message === 'Snapshot not found') {
        return res.status(404).json({ error: 'No snapshots available' });
      }
      throw error;
    }
  }));

  // ===========================================================================
  // WebSocket Broadcast
  // ===========================================================================

  /**
   * GET /api/gratitude/new - Broadcast custom item via WebSocket
   */
  router.get('/new', (req, res) => {
    const { text } = req.query;

    if (!text) {
      return res.status(400).json({ error: 'Missing required parameter: text' });
    }

    const itemData = {
      id: Date.now(),
      text: text.trim()
    };

    const payload = {
      topic: 'gratitude',
      item: itemData,
      timestamp: nowTs(),
      type: 'gratitude_item',
      isCustom: true
    };

    broadcastToWebsockets(payload);

    res.json({
      status: 'success',
      message: 'Custom item sent to gratitude selector',
      item: itemData,
      payload
    });
  });

  // ===========================================================================
  // Print Support
  // ===========================================================================

  /**
   * GET /api/gratitude/print - Get selections formatted for printing
   */
  router.get('/print', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const result = await gratitudeService.getSelectionsForPrint(
      householdId,
      resolveDisplayName
    );

    res.json({
      ...result,
      _household: householdId
    });
  }));

  /**
   * POST /api/gratitude/print/mark - Mark selections as printed
   */
  router.post('/print/mark', asyncHandler(async (req, res) => {
    const { category, selectionIds } = req.body || {};

    if (!category || !Array.isArray(selectionIds)) {
      return res.status(400).json({ error: 'Missing category or selectionIds' });
    }

    const validCategory = validateCategory(category);
    if (!validCategory) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const householdId = getHouseholdId(req);
    const timestamp = generateTimestamp(householdId);
    await gratitudeService.markAsPrinted(householdId, validCategory, selectionIds, timestamp);

    res.json({
      marked: selectionIds.length,
      _household: householdId
    });
  }));

  // ===========================================================================
  // Prayer Card Endpoints
  // ===========================================================================

  /**
   * GET /api/gratitude/card - Preview prayer card as PNG image
   * Query params:
   *   - upsidedown: 'true' to flip for mounted printer
   *
   * Note: The createPrayerCardCanvas function fetches selections internally
   * using the legacy bridge which delegates to the DDD GratitudeService.
   */
  router.get('/card', asyncHandler(async (req, res) => {
    if (!createPrayerCardCanvas) {
      return res.status(501).json({
        error: 'Prayer card generation not configured'
      });
    }

    const upsidedown = req.query.upsidedown === 'true';

    // Generate canvas (function fetches selections internally)
    const { canvas } = await createPrayerCardCanvas(upsidedown);

    // Convert to PNG buffer
    const buffer = canvas.toBuffer('image/png');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', 'inline; filename="prayer-card.png"');
    res.send(buffer);
  }));

  /**
   * GET /api/gratitude/card/print - Generate and print prayer card
   * Only marks items as printed if print succeeds
   * Query params:
   *   - upsidedown: 'true' to flip for mounted printer (default: true for print)
   *
   * Note: The createPrayerCardCanvas function returns selectedIds that were
   * included in the generated card, which are then marked as printed.
   */
  router.get('/card/print', asyncHandler(async (req, res) => {
    if (!createPrayerCardCanvas) {
      return res.status(501).json({
        error: 'Prayer card generation not configured',
        success: false
      });
    }

    if (!printerAdapter) {
      return res.status(501).json({
        error: 'Printer not configured',
        success: false
      });
    }

    const householdId = getHouseholdId(req);
    const upsidedown = req.query.upsidedown !== 'false'; // default true for print

    // Generate canvas (function fetches selections internally and returns selectedIds)
    const { canvas, width, height, selectedIds } = await createPrayerCardCanvas(upsidedown);

    // Save to temp file
    const buffer = canvas.toBuffer('image/png');
    const tempPath = `/tmp/prayer_card_${Date.now()}.png`;
    writeBinary(tempPath, buffer);

    // Create and execute print job
    const printJob = printerAdapter.createImagePrint(tempPath, {
      width,
      height,
      align: 'left',
      threshold: 128
    });

    const success = await printerAdapter.print(printJob);

    // Clean up temp file
    deleteFile(tempPath);

    // Mark as printed only if print succeeded
    const printed = { gratitude: [], hopes: [] };

    if (success && selectedIds) {
      const timestamp = generateTimestamp(householdId);
      if (selectedIds.gratitude?.length > 0) {
        await gratitudeService.markAsPrinted(householdId, 'gratitude', selectedIds.gratitude, timestamp);
        printed.gratitude = selectedIds.gratitude;
      }
      if (selectedIds.hopes?.length > 0) {
        await gratitudeService.markAsPrinted(householdId, 'hopes', selectedIds.hopes, timestamp);
        printed.hopes = selectedIds.hopes;
      }
    }

    res.json({
      success,
      message: success ? 'Prayer card printed successfully' : 'Print failed',
      printed,
      timestamp: nowTs()
    });
  }));

  return router;
}

export default createGratitudeRouter;
