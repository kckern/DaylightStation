export { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';
export { ReolinkStateAdapter } from './ReolinkStateAdapter.mjs';
export { HlsStreamManager } from './HlsStreamManager.mjs';
export { HomeAssistantControlAdapter } from './HomeAssistantControlAdapter.mjs';

import { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';

/**
 * Create a Reolink camera adapter.
 * ConfigService is injected by the composition root (bootstrap) rather than
 * pulled from a module-level singleton, so this factory stays layer-clean.
 * @param {Object} options
 * @param {Object} options.configService - ConfigService instance (injected)
 * @param {string} [options.householdId]
 * @param {Object} [options.logger]
 * @returns {ReolinkCameraAdapter}
 */
export function createCameraAdapter({ configService, householdId, logger } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);
  return new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
}
