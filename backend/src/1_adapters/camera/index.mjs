export { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';

import { configService } from '#system/config/index.mjs';
import { ReolinkCameraAdapter } from './ReolinkCameraAdapter.mjs';

export function createCameraAdapter({ householdId, logger } = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);
  return new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
}
