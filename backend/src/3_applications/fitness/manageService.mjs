// backend/src/3_applications/fitness/manageService.mjs
import { isBiometricGateway } from './ports/IBiometricGateway.mjs';

let singleton = null;

/** Process-level fingerprint enrollment/deletion service. First gateway wins. */
export function initManageService({ biometricGateway } = {}) {
  if (singleton) return singleton;
  if (!isBiometricGateway(biometricGateway)) {
    throw new Error('initManageService: biometricGateway is required');
  }

  singleton = {
    requestEnroll({ finger, username, clientToken }) {
      return biometricGateway.requestEnroll({ finger, username, clientToken });
    },
    requestDelete({ uuid }) {
      return biometricGateway.requestDelete({ uuid });
    },
  };
  return singleton;
}

export function getManageService() {
  return singleton;
}

export function _resetManageServiceForTests() {
  singleton = null;
}
