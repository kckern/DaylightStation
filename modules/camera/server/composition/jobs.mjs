import { createCameraLedgerJobHandler } from "../application/cameraLedgerJobHandler.mjs";
import { createCameraArchiveJobHandler } from "../application/cameraArchiveJobHandler.mjs";
import { ReolinkClient, makeSource, parseTriggerBits } from "../adapters/ReolinkRecordingAdapter.mjs";
import { createHaDetectionSource } from "../adapters/HaDetectionSource.mjs";
import { ArchiveEncoder } from "../adapters/ArchiveEncoder.mjs";
import { ArchiveManifestStore } from "../adapters/ArchiveManifestStore.mjs";

export async function registerCameraJobs({ configService, householdAdapters, householdId, mediaExecutor, rootLogger }) {
  const { ConfiguredCameraJobRuntimeGateway } = await import("./ConfiguredCameraJobRuntimeGateway.mjs");
  const { CameraLedgerStore } = await import("../adapters/CameraLedgerStore.mjs");
  const { FilesystemCameraArchiveArtifacts } = await import("../adapters/FilesystemCameraArchiveArtifacts.mjs");
  const { FilesystemContactSheetArtifacts } = await import("../adapters/FilesystemContactSheetArtifacts.mjs");
  const cameraRuntimeGateway = new ConfiguredCameraJobRuntimeGateway({
    configService,
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    factories: {
      createReolinkClient: (options) => new ReolinkClient(options),
      makeSource,
      createDetectionSource: (options) => createHaDetectionSource(options),
      decodeTriggerBits: parseTriggerBits,
      createEncoder: (options) => new ArchiveEncoder(options),
      createManifestStore: (options) => new ArchiveManifestStore(options),
      createArchiveArtifacts: (options) => new FilesystemCameraArchiveArtifacts(options),
      createSheetArtifacts: () => new FilesystemContactSheetArtifacts(),
    },
  });
  const cameraLedgerStore = new CameraLedgerStore({
    resolveDestinations: () => configService
      .getHouseholdAppConfig(householdId, 'camera-archive')?.storage?.ledgerPaths || [],
  });
  mediaExecutor.register('camera-ledger', createCameraLedgerJobHandler({
    runtimeGateway: cameraRuntimeGateway,
    ledgerStore: cameraLedgerStore,
    householdId,
    logger: rootLogger.child({ module: 'camera-ledger' })
  }));

  // Camera archive (Pipeline A) — scored session selection under a hard budget
  // cap, plus day/night timelapses. Scheduled AFTER camera-ledger so the day's
  // detections exist to select against; without them selection degrades to
  // duration and bitrate density alone.
  mediaExecutor.register('camera-archive', createCameraArchiveJobHandler({
    runtimeGateway: cameraRuntimeGateway,
    ledgerStore: cameraLedgerStore,
    householdId,
    logger: rootLogger.child({ module: 'camera-archive' })
  }));


}
