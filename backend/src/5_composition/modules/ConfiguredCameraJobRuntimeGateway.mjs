import { ICameraJobRuntimeGateway } from '#apps/camera/ports/ICameraJobRuntimeGateway.mjs';

export function resolveCameraEndpoint(configService, deviceId, householdId) {
  const device = configService.getDeviceConfig(deviceId, householdId);
  if (!device?.host) {
    throw new Error(`camera device '${deviceId}' has no host in devices.yml`);
  }
  return { host: device.host, authRef: device.auth_ref };
}

/** Composition-owned camera runtime graph assembled from deployment config. */
export class ConfiguredCameraJobRuntimeGateway extends ICameraJobRuntimeGateway {
  #configService; #haGateway; #factories;

  constructor({ configService, haGateway = null, factories = {} } = {}) {
    super();
    if (!configService) throw new TypeError('ConfiguredCameraJobRuntimeGateway requires configService');
    this.#configService = configService;
    this.#haGateway = haGateway;
    this.#factories = factories;
  }

  #rawPlan(householdId) {
    return this.#configService.getHouseholdAppConfig(householdId, 'camera-archive');
  }

  loadLedgerPlan(householdId = null) {
    const raw = this.#rawPlan(householdId);
    if (!raw) return null;
    return {
      cameras: raw.cameras || [],
      dayOffset: raw.ledger?.dayOffset ?? -1,
      filenameBitsByCamera: raw.classification?.filenameBits ?? {},
    };
  }

  loadArchivePlan(householdId = null) {
    const raw = this.#rawPlan(householdId);
    if (!raw) return null;
    return {
      enabled: raw.archive?.enabled !== false,
      dayOffset: raw.archive?.dayOffset ?? -1,
      cameras: raw.cameras || [],
      policy: {
        sessionize: raw.sessionize,
        matchToleranceSeconds: raw.classification?.matchToleranceSeconds ?? 15,
        scoring: raw.scoring,
        fullClipsBudgetMB: raw.budget?.fullClipsMB,
        compressionRatio: raw.budget?.compressionRatio,
        sun: raw.sun,
        contactSheets: raw.contactSheets,
        provenance: {
          source: raw.sources?.footageFrom ?? 'nvr',
          streamType: raw.sources?.streamType ?? 'sub',
        },
        activeAudioHours: raw.audio?.activeHours,
        audioEncoding: raw.encoding?.audioSidecar,
        fullClipEncoding: raw.encoding?.fullClip,
        timelapse: raw.timelapse,
        discardSourceAfterExtract: raw.sources?.deleteSourceAfterExtract === true,
      },
    };
  }

  createLedgerRuntime({ householdId = null, logger = console } = {}) {
    const plan = this.#rawPlan(householdId);
    const auth = this.#resolveAuth(householdId);
    const detectionSource = this.#haGateway
      ? this.#factories.createDetectionSource?.({
          haGateway: this.#haGateway,
          sensorsByCamera: plan.classification?.sensorsByCamera ?? {},
          logger,
        })
      : null;
    return {
      detectionSource,
      decodeTriggerBits: this.#factories.decodeTriggerBits,
      createSources: (camera) => this.#createSources(camera, plan, auth, householdId, logger),
    };
  }

  createArchiveRuntime({ householdId = null, logger = console } = {}) {
    const plan = this.#rawPlan(householdId);
    const auth = this.#resolveAuth(householdId);
    return {
      encoder: this.#factories.createEncoder?.({ logger }),
      manifestStore: this.#factories.createManifestStore?.({ root: plan.storage.hotPath, logger }),
      archiveArtifacts: this.#factories.createArchiveArtifacts?.({
        workRoot: plan.storage.workDir,
        hotRoot: plan.storage.hotPath,
      }),
      sheetArtifacts: this.#factories.createSheetArtifacts?.(),
      createSources: (camera) => {
        const sources = this.#createSources(camera, plan, auth, householdId, logger);
        return {
          footage: sources[plan.sources?.footageFrom ?? 'nvr'],
          metadata: sources[plan.sources?.metadataFrom ?? 'camera'],
        };
      },
    };
  }

  #resolveAuth(householdId) {
    let authRef;
    try {
      ({ authRef } = resolveCameraEndpoint(this.#configService, 'camera-nvr', householdId));
    } catch (error) {
      error.code = 'CAMERA_AUTH_UNAVAILABLE';
      throw error;
    }
    const auth = this.#configService.getHouseholdAuth(authRef, householdId);
    if (!auth?.username || !auth?.password) {
      const error = new Error(`camera credentials unavailable${authRef ? ` for '${authRef}'` : ''}`);
      error.code = 'CAMERA_AUTH_UNAVAILABLE';
      throw error;
    }
    return auth;
  }

  #createSources(camera, plan, auth, householdId, logger) {
    const streamType = plan.sources?.streamType ?? 'sub';
    const { host: cameraHost } = resolveCameraEndpoint(this.#configService, camera.id, householdId);
    const { host: nvrHost } = resolveCameraEndpoint(this.#configService, 'camera-nvr', householdId);
    return {
      camera: makeCameraSource({
        kind: 'camera',
        client: this.#factories.createReolinkClient?.({ host: cameraHost, ...auth, logger }),
        channel: 0,
        streamType,
      }, this.#factories.makeSource),
      nvr: makeCameraSource({
        kind: 'nvr',
        client: this.#factories.createReolinkClient?.({ host: nvrHost, ...auth, logger }),
        channel: camera.nvrChannel,
        streamType,
      }, this.#factories.makeSource),
    };
  }
}

function makeCameraSource(spec, factory) {
  if (typeof factory !== 'function') throw new Error('ConfiguredCameraJobRuntimeGateway requires makeSource factory');
  return factory(spec);
}

export default ConfiguredCameraJobRuntimeGateway;
