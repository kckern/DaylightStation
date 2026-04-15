export { CameraService } from './CameraService.mjs';
export * from './ports/index.mjs';

import { configService } from '#system/config/index.mjs';
import { ReolinkCameraAdapter } from '#adapters/camera/ReolinkCameraAdapter.mjs';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';
import { ReolinkStateAdapter } from '#adapters/camera/ReolinkStateAdapter.mjs';
import { HomeAssistantControlAdapter } from '#adapters/camera/HomeAssistantControlAdapter.mjs';
import { CameraService } from './CameraService.mjs';

/**
 * Create camera application services.
 * @param {Object} options
 * @param {string} [options.householdId]
 * @param {Object} [options.haGateway]
 * @param {Object} [options.logger]
 * @returns {{ cameraService: CameraService }}
 */
export function createCameraServices({ householdId, haGateway, logger = console } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);

  const gateway = new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
  const streamAdapter = new HlsStreamManager({ logger });
  const stateGateway = new ReolinkStateAdapter({ devicesConfig, getAuth, logger });
  const controlGateway = haGateway
    ? new HomeAssistantControlAdapter({ devicesConfig, haGateway, logger })
    : null;

  const cameraService = new CameraService({
    gateway, streamAdapter, stateGateway, controlGateway, logger,
  });

  return { cameraService };
}
