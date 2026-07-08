// backend/src/5_composition/modules/homeApi.mjs
// Composition wiring for HomeAutomation API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createHomeAutomationRouter } from '#api/v1/routers/homeAutomation.mjs';
import { HomeAutomationContainer } from '#apps/home-automation/HomeAutomationContainer.mjs';
import { CallHomeAssistantService } from '#apps/home-automation/usecases/CallHomeAssistantService.mjs';
import { createHomeAutomationAdapters } from '../bootstrap.mjs';
import { YamlHomeDashboardConfigRepository } from '#adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs';
import { createHomeDashboardRouter } from '#api/v1/routers/home-dashboard.mjs';
import { dataService } from '#system/config/index.mjs';

/**
 * Create home automation API router
 * @param {Object} config
 * @param {Object} config.adapters - Adapters from createHomeAutomationAdapters
 * @param {Function} [config.loadFile] - Function to load state files
 * @param {Function} [config.saveFile] - Function to save state files
 * @param {string} [config.householdId] - Household ID
 * @param {Object} [config.entropyService] - Entropy service for data freshness
 * @param {Object} [config.configService] - Config service for user lookup
 * @param {Object} [config.eventAggregationService] - Event aggregation service
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHomeAutomationApiRouter(config) {
  const {
    adapters,
    loadFile,
    saveFile,
    householdId,
    entropyService,
    configService,
    eventAggregationService,
    immichAdapter,
    artAdapter,
    logger = console
  } = config;

  // HA-call use case: wraps haGateway.callService for the /ha/call and
  // /ha/script/:scriptId endpoints. Constructed inline because there's no
  // home-automation container that owns it yet; if more HA-call call sites
  // appear, lift this into HomeAutomationContainer.
  const callHomeAssistantService = adapters.haGateway
    ? new CallHomeAssistantService({ haGateway: adapters.haGateway, logger })
    : null;

  return createHomeAutomationRouter({
    haGateway: adapters.haGateway,
    tvAdapter: adapters.tvAdapter,
    kioskAdapter: adapters.kioskAdapter,
    taskerAdapter: adapters.taskerAdapter,
    remoteExecAdapter: adapters.remoteExecAdapter,
    loadFile,
    saveFile,
    householdId,
    entropyService,
    configService,
    eventAggregationService,
    immichAdapter,
    artAdapter,
    callHomeAssistantService,
    logger
  });
}

/**
 * Create the home-dashboard Express router for /api/v1/home-dashboard.
 *
 * Composes the YAML config repository and the HomeAutomationContainer,
 * then produces a thin Express router. Returns `null` when `haGateway`
 * is unavailable (HA not configured) — caller should skip mounting.
 *
 * @param {Object} config
 * @param {Object} [config.haGateway] - Home Assistant gateway
 * @param {Object} config.configService - ConfigService for household resolution
 * @param {Object} [config.logger] - Logger instance
 * @returns {import('express').Router|null}
 */
export function createHomeDashboardApiRouter(config) {
  const { haGateway, configService, logger = console } = config;

  if (!haGateway) {
    logger.warn?.('home.dashboard.disabled', { reason: 'no haGateway' });
    return null;
  }

  const configRepository = new YamlHomeDashboardConfigRepository({
    dataService,
    configService,
    logger,
  });

  const container = new HomeAutomationContainer({
    configRepository,
    haGateway,
    logger,
  });

  return createHomeDashboardRouter({ container, logger });
}
