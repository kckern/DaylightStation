import { CameraService } from "./application/CameraService.mjs";
import { ReolinkCameraAdapter } from "./adapters/ReolinkCameraAdapter.mjs";
import { HlsStreamManager } from "./adapters/HlsStreamManager.mjs";
import { ReolinkStateAdapter } from "./adapters/ReolinkStateAdapter.mjs";
import { HomeAssistantControlAdapter } from "./adapters/HomeAssistantControlAdapter.mjs";

export function createCameraServices({ configService, householdId, haGateway, logger = console } = {}) {
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
