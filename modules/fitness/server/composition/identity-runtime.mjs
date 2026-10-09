/** Existing fitness identity runtime assembly; preserves construction order. */
import { EventBusBiometricGateway as EventBusBiometricGateway } from "../adapters/EventBusBiometricGateway.mjs";
import { initUnlockService as initUnlockService } from "../application/unlockService.mjs";
import { initManageService as initManageService } from "../application/manageService.mjs";
import { createFingerprintProfileWriter as createFingerprintProfileWriter } from "../application/fingerprintProfileWriter.mjs";

export async function createFitnessIdentityRuntime(dependencies) {
  const { eventBus, YamlUserProfileDatastore, configService } = dependencies;
const biometricGateway = new EventBusBiometricGateway({ eventBus });
  initUnlockService({
    biometricGateway,
  });

  // Fingerprint manager — enroll/delete relay over the same garage WS, plus the
  // browser progress rebroadcast. Auth reuses the unlock service above.
  initManageService({
    biometricGateway,
  });
  // Persistence adapter (1_adapters) → application writer (3_applications): the
  // writer never touches the filesystem itself, satisfying the DDD layering.
  const userProfileDatastore = new YamlUserProfileDatastore({ configService });
  const fingerprintProfileWriter = createFingerprintProfileWriter({
    datastore: userProfileDatastore,
    profileCache: { refresh: (username) => configService.reloadUserProfile(username) },
  });
  return { fingerprintProfileWriter };
}
