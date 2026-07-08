// backend/src/5_composition/modules/gratitudeApi.mjs
// Composition wiring for Gratitude API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createGratitudeRouter } from '#api/v1/routers/gratitude.mjs';
import { GratitudeHouseholdService } from '#apps/gratitude/services/GratitudeHouseholdService.mjs';
import { createGratitudeServices } from '../bootstrap.mjs';

/**
 * Create gratitude API router
 * @param {Object} config
 * @param {Object} config.gratitudeServices - Services from createGratitudeServices
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Function} config.broadcastToWebsockets - WebSocket broadcast function
 * @param {Object} [config.printerRegistry] - ThermalPrinterRegistry for resolving per-location printers
 * @param {Function} [config.createGratitudeCardCanvas] - Function to generate gratitude card canvas
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createGratitudeApiRouter(config) {
  const {
    gratitudeServices,
    configService,
    broadcastToWebsockets,
    printerRegistry,
    createGratitudeCardCanvas,
    logger = console
  } = config;

  // Application service for household-related helpers
  const gratitudeHouseholdService = new GratitudeHouseholdService({
    configService,
    gratitudeService: gratitudeServices.gratitudeService
  });

  return createGratitudeRouter({
    gratitudeService: gratitudeServices.gratitudeService,
    configService,
    gratitudeHouseholdService,
    broadcastToWebsockets,
    printerRegistry,
    createGratitudeCardCanvas,
    logger
  });
}
