/**
 * Legacy Gratitude Router Bridge
 *
 * This file now delegates to the new clean architecture implementation.
 * It maintains backward compatibility by re-exporting the new router
 * and providing legacy helper functions.
 *
 * New implementation: backend/src/1_domains/gratitude/
 * New router: backend/src/4_api/routers/gratitude.mjs
 */

import { configService } from '../lib/config/index.mjs';
import { userDataService } from '../../src/0_system/config/UserDataService.mjs';
import { broadcastToWebsockets } from './websocket.mjs';
import { createLogger } from '../lib/logging/logger.js';

// Import new architecture components
import { GratitudeService } from '../../src/1_domains/gratitude/services/GratitudeService.mjs';
import { YamlGratitudeStore } from '../../src/2_adapters/persistence/yaml/YamlGratitudeStore.mjs';
import { createGratitudeRouter } from '../../src/4_api/routers/gratitude.mjs';

const gratitudeLogger = createLogger({ app: 'gratitude' });

// Create the new architecture services
const gratitudeStore = new YamlGratitudeStore({
  userDataService,
  logger: gratitudeLogger
});

const gratitudeService = new GratitudeService({
  store: gratitudeStore,
  logger: gratitudeLogger
});

// Create the new router
const gratitudeRouter = createGratitudeRouter({
  gratitudeService,
  configService,
  broadcastToWebsockets,
  logger: gratitudeLogger
});

// =============================================================================
// Legacy Helper Functions (for printer.mjs integration)
// =============================================================================

/**
 * Resolve display name for a user
 * @param {string} userId - Username to resolve
 * @returns {string} Display name
 */
function resolveDisplayName(userId) {
  if (!userId) return 'Unknown';
  const profile = configService.getUserProfile(userId);
  return profile?.group_label
    || profile?.display_name
    || profile?.name
    || userId.charAt(0).toUpperCase() + userId.slice(1);
}

/**
 * Get selections formatted for printing with user display names
 * Returns enriched selection objects with displayName and printCount
 * @returns {Promise<{ gratitude: Array, hopes: Array }>}
 */
export async function getSelectionsForPrint() {
  const householdId = configService.getDefaultHouseholdId();
  return gratitudeService.getSelectionsForPrint(householdId, resolveDisplayName);
}

/**
 * Mark selections as printed by appending timestamp to their printed array
 * @param {string} category - 'gratitude' or 'hopes'
 * @param {string[]} selectionIds - Array of selection entry IDs to mark
 */
export async function markSelectionsAsPrinted(category, selectionIds) {
  if (!['gratitude', 'hopes'].includes(category)) {
    gratitudeLogger.warn('gratitude.mark_printed.invalid_category', { category });
    return;
  }

  if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
    return;
  }

  const householdId = configService.getDefaultHouseholdId();
  await gratitudeService.markAsPrinted(householdId, category, selectionIds);
}

// =============================================================================
// Prayer Card Routes (kept here for printer.mjs integration)
// =============================================================================

/**
 * Generate Prayer Card canvas image (preview only - never marks items)
 * GET /api/gratitude/card - Returns PNG image
 * Query params:
 *   - upsidedown: 'true' to flip for mounted printer
 */
gratitudeRouter.get('/card', async (req, res) => {
  try {
    // Dynamically import canvas function to avoid circular dependency
    const { createCanvasTypographyDemo } = await import('./printer.mjs');

    const upsidedown = req.query.upsidedown === 'true';
    const { canvas } = await createCanvasTypographyDemo(upsidedown);

    // Convert to PNG buffer
    const buffer = canvas.toBuffer('image/png');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', 'inline; filename="prayer-card.png"');
    res.send(buffer);
  } catch (error) {
    console.error('Prayer card generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate Prayer Card and print to thermal printer
 * Only marks items as printed if print succeeds
 * GET /api/gratitude/card/print
 * Query params:
 *   - upsidedown: 'true' to flip for mounted printer (default: true for print)
 */
gratitudeRouter.get('/card/print', async (req, res) => {
  try {
    const { createCanvasTypographyDemo } = await import('./printer.mjs');
    const { thermalPrint, createImagePrint } = await import('../lib/thermalprint.mjs');
    const fs = await import('fs');

    // 1. Generate canvas (default upside down for printer)
    const upsidedown = req.query.upsidedown !== 'false'; // default true
    const { canvas, width, height, selectedIds } = await createCanvasTypographyDemo(upsidedown);

    // 2. Save to temp file
    const buffer = canvas.toBuffer('image/png');
    const tempPath = `/tmp/prayer_card_${Date.now()}.png`;
    fs.writeFileSync(tempPath, buffer);

    // 3. Create print job
    const printJob = createImagePrint(tempPath, {
      width,
      height,
      align: 'left',
      threshold: 128
    });

    // 4. Send to printer and wait for result
    const success = await thermalPrint(printJob);

    // 5. Clean up temp file
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }

    // 6. Only mark as printed if print succeeded
    const printed = { gratitude: [], hopes: [] };

    if (success && selectedIds) {
      if (selectedIds.gratitude?.length > 0) {
        await markSelectionsAsPrinted('gratitude', selectedIds.gratitude);
        printed.gratitude = selectedIds.gratitude;
      }
      if (selectedIds.hopes?.length > 0) {
        await markSelectionsAsPrinted('hopes', selectedIds.hopes);
        printed.hopes = selectedIds.hopes;
      }
    }

    // 7. Return result
    res.json({
      success,
      message: success ? 'Prayer card printed successfully' : 'Print failed',
      printed,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Prayer card print error:', error);
    res.status(500).json({
      success: false,
      message: 'Print error',
      error: error.message,
      printed: { gratitude: [], hopes: [] }
    });
  }
});

export default gratitudeRouter;
