import { CameraService } from "./application/CameraService.mjs";
import { ReolinkCameraAdapter } from "./adapters/ReolinkCameraAdapter.mjs";
import { HlsStreamManager } from "./adapters/HlsStreamManager.mjs";
import { ReolinkStateAdapter } from "./adapters/ReolinkStateAdapter.mjs";
import { HomeAssistantControlAdapter } from "./adapters/HomeAssistantControlAdapter.mjs";
import { CameraClipLibrary, INTERACTIVE_CLIP_DOWNLOAD } from "./adapters/CameraClipLibrary.mjs";
import { CameraLedgerStore } from "./adapters/CameraLedgerStore.mjs";
import { ReolinkClient, makeSource } from "./adapters/ReolinkRecordingAdapter.mjs";
import { ConfiguredCameraJobRuntimeGateway } from "./composition/ConfiguredCameraJobRuntimeGateway.mjs";

/**
 * Resolve a camera's on-device recording source through the archive plan.
 * Built per call so a credentials or plan change takes effect without a
 * restart; returns null (logged) when the camera cannot be reached that way.
 */
export function createCameraClipSourceResolver({ configService, householdId, logger = console, factories = {} }) {
  const runtimeGateway = new ConfiguredCameraJobRuntimeGateway({
    configService,
    factories: {
      createReolinkClient: factories.createReolinkClient ?? ((options) => new ReolinkClient(options)),
      makeSource: factories.makeSource ?? makeSource,
    },
  });
  return (cameraId) => {
    try {
      const cameraCfg = runtimeGateway.loadLedgerPlan(householdId)?.cameras?.find((camera) => camera?.id === cameraId);
      if (!cameraCfg) {
        logger.warn?.('camera.clips.source_unavailable', { camera: cameraId, reason: 'not-in-archive-plan' });
        return null;
      }
      return runtimeGateway.createLedgerRuntime({ householdId, logger }).createSources(cameraCfg).camera;
    } catch (error) {
      logger.warn?.('camera.clips.source_unavailable', { camera: cameraId, reason: error.code || 'error', error: error.message });
      return null;
    }
  };
}

/**
 * @param {Object} deps
 * @param {Object} [deps.clipDownloadPolicy] - `{timeoutMs, retries, backoffMs}` for a clip
 *   fetched while someone waits on it; defaults to the short interactive policy
 */
export function createCameraServices({
  configService, householdId, haGateway, logger = console, clipDownloadPolicy = INTERACTIVE_CLIP_DOWNLOAD,
} = {}) {
  const devicesConfig = configService.getHouseholdDevices(householdId)?.devices || {};
  const getAuth = (authRef) => configService.getHouseholdAuth(authRef, householdId);

  const gateway = new ReolinkCameraAdapter({ devicesConfig, getAuth, logger });
  const streamAdapter = new HlsStreamManager({ logger });
  const stateGateway = new ReolinkStateAdapter({ devicesConfig, getAuth, logger });
  const controlGateway = haGateway
    ? new HomeAssistantControlAdapter({ devicesConfig, haGateway, logger })
    : null;

  const clipLogger = logger.child?.({ component: 'camera-clips' }) ?? logger;
  const clipLibrary = new CameraClipLibrary({
    ledgerStore: new CameraLedgerStore({
      resolveDestinations: () => configService
        .getHouseholdAppConfig(householdId, 'camera-archive')?.storage?.ledgerPaths || [],
    }),
    openSource: createCameraClipSourceResolver({ configService, householdId, logger: clipLogger }),
    logger: clipLogger,
    downloadPolicy: clipDownloadPolicy,
  });

  const cameraService = new CameraService({
    gateway, streamAdapter, stateGateway, controlGateway, clipLibrary, logger,
  });

  return { cameraService };
}
