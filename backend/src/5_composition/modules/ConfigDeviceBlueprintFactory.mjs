import { IDeviceBlueprintFactory } from '#apps/devices/ports/IDeviceBlueprintFactory.mjs';

/**
 * Composition-owned device graph builder. It translates deployment topology,
 * selects providers, and constructs the concrete capabilities wired into a
 * semantic Device blueprint.
 */
export class ConfigDeviceBlueprintFactory extends IDeviceBlueprintFactory {
  #haGateway; #httpClient; #wsBus; #remoteExec; #daylightHost; #configService; #logger; #factories;

  constructor({
    haGateway = null,
    httpClient = null,
    wsBus = null,
    remoteExec = null,
    daylightHost = null,
    configService = null,
    factories = {},
    logger = console,
  } = {}) {
    super();
    this.#haGateway = haGateway;
    this.#httpClient = httpClient;
    this.#wsBus = wsBus;
    this.#remoteExec = remoteExec;
    this.#daylightHost = daylightHost;
    this.#configService = configService;
    this.#factories = factories;
    this.#logger = logger;
  }

  async createBlueprint(deviceId, source = {}) {
    const capabilities = {
      deviceControl: source.device_control?.displays
        ? this.#createDeviceControl(source.device_control)
        : null,
      osControl: source.os_control ? this.#createOsControl(source.os_control) : null,
      contentControl: source.content_control
        ? this.#createContentControl(deviceId, source.content_control, source.camera_check)
        : null,
    };

    return {
      descriptor: {
        id: deviceId,
        type: source.type,
        defaultVolume: source.default_volume,
        screenPath: source.screen_path,
        notifyService: source.notify_service ?? null,
      },
      capabilities,
    };
  }

  #createDeviceControl(config) {
    if (!this.#haGateway) {
      this.#logger.warn?.('deviceFactory.noHaGateway');
      return null;
    }
    const displays = {};
    for (const [displayId, displayConfig] of Object.entries(config.displays)) {
      displays[displayId] = {
        on_script: displayConfig.on_script,
        off_script: displayConfig.off_script,
        volume_script: displayConfig.volume_script,
        state_sensor: displayConfig.state_sensor,
        ...(displayConfig.powerOnRetries != null && { powerOnRetries: displayConfig.powerOnRetries }),
      };
    }
    const adapterConfig = { displays };
    if (config.powerOnWaitOptions) adapterConfig.powerOnWaitOptions = config.powerOnWaitOptions;
    if (config.waitOptions) adapterConfig.waitOptions = config.waitOptions;
    return this.#factories.deviceControl?.(adapterConfig, {
      gateway: this.#haGateway,
      logger: this.#logger,
    }) ?? null;
  }

  #createOsControl(config) {
    if (config.provider !== 'ssh') {
      this.#logger.warn?.('deviceFactory.unsupportedOsProvider', { provider: config.provider });
      return null;
    }
    if (!this.#remoteExec) {
      this.#logger.warn?.('deviceFactory.noRemoteExec');
      return null;
    }
    return this.#factories.sshOs?.({
      host: config.host,
      user: config.user,
      port: config.port,
      commands: config.commands || {},
    }, { remoteExec: this.#remoteExec, logger: this.#logger }) ?? null;
  }

  #createContentControl(deviceId, config, cameraCheck) {
    if (config.provider === 'fully-kiosk') {
      if (!this.#httpClient) {
        this.#logger.warn?.('deviceFactory.noHttpClient');
        return null;
      }
      let password = config.password;
      if (!password && config.auth_ref && this.#configService) {
        const auth = this.#configService.getHouseholdAuth?.(config.auth_ref);
        password = auth?.password;
        if (!password) this.#logger.warn?.('deviceFactory.noAuthPassword', { auth_ref: config.auth_ref });
      }

      let recovery = null;
      let launchActivity = null;
      if (config.fallback?.provider === 'adb') {
        recovery = this.#factories.adb?.({
          host: config.fallback.host,
          port: config.fallback.port,
        }, { logger: this.#logger }) ?? null;
        launchActivity = config.fallback.launch_activity;
        this.#logger.info?.('deviceFactory.resilientContentControl', {
          primary: 'fully-kiosk',
          fallback: 'adb',
          adbSerial: `${config.fallback.host}:${config.fallback.port}`,
        });
      }

      const primary = this.#factories.fullyKiosk?.({
        host: config.host,
        port: config.port,
        password: password || '',
        daylightHost: this.#daylightHost,
        launchActivity,
        companionApps: config.companion_apps || [],
        cameraCheckPaths: cameraCheck?.paths,
      }, { httpClient: this.#httpClient, logger: this.#logger, adbAdapter: recovery });
      if (!primary) return null;

      return recovery
        ? this.#factories.resilient?.({ primary, recovery, launchActivity }, { logger: this.#logger }) ?? primary
        : primary;
    }

    if (config.provider === 'websocket') {
      if (!this.#wsBus) {
        this.#logger.warn?.('deviceFactory.noWsBus');
        return null;
      }
      return this.#factories.websocket?.({
        topic: config.topic,
        deviceId,
        daylightHost: this.#daylightHost,
      }, { wsBus: this.#wsBus, logger: this.#logger }) ?? null;
    }

    this.#logger.warn?.('deviceFactory.unsupportedContentProvider', { provider: config.provider });
    return null;
  }
}

export default ConfigDeviceBlueprintFactory;
