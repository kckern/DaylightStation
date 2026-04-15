export { CameraService } from './CameraService.mjs';
export * from './ports/index.mjs';

import { configService } from '#system/config/index.mjs';
import { ReolinkCameraAdapter } from '#adapters/camera/ReolinkCameraAdapter.mjs';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';
import { CameraService } from './CameraService.mjs';

/**
 * Create camera application services.
 * @param {Object} options
 * @param {string} [options.householdId]
 * @param {Object} [options.logger]
 * @returns {{ cameraService: CameraService }}
 */
export function createCameraServices({ householdId, logger = console } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);

  const gateway = new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
  const streamAdapter = new HlsStreamManager({ logger });
  const cameraService = new CameraService({ gateway, streamAdapter, logger });

  return { cameraService };
}
