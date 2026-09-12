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
      volumeControl: source.volume ? this.#createVolumeControl(source) : null,
    };

    return {
      descriptor: {
        id: deviceId,
        type: source.type,
        // How a person names this device. devices.yml has carried `name`,
        // `location` and `icon` from the start; nothing read them, so every
        // picker built on GET /api/v1/device showed the raw slug
        // ("yellow-room-tablet") instead of "Piano Tablet · Yellow Room".
        name: source.name ?? null,
        location: source.location ?? null,
        icon: source.icon ?? null,
        // Whether this device may be the far end of a Home Line call.
        //
        // DECLARED, never inferred. A call needs a camera and a microphone at
        // the far end, and nothing else in this file reliably implies either:
        // `content_control` is what every kiosk panel has, which is why /call
        // used to offer the office PC and two cameraless tablets alongside the
        // one TV that can actually answer. A device opts in with
        // `video_call: true`; anything silent is not a call target, so a new
        // screen is never offered a camera it does not have.
        videoCall: source.video_call === true,
        // Whether this device's play time is metered, and whether it may carry
        // a countdown overlay.
        //
        // DECLARED, never inferred, for the same reason as `video_call` above
        // and with sharper consequences. Observation costs a polling loop
        // against a device; the overlay is durable device state that renders
        // over EVERYTHING that screen shows, not only over games. Inferring
        // either from "has a screen" or "can launch a game" would eventually
        // put a countdown on a wall panel showing artwork. A device opts in;
        // silence means no meter and no overlay, with no code path that can
        // create one.
        playObservation: source.play_observation === true,
        playOverlay: source.play_overlay === true,
        defaultVolume: source.default_volume,
        // Volume governance. `cap` is the everyday ceiling; `boost_max` is the
        // highest a temporary override may ever reach. Absent `volume:` block =
        // ungoverned, which is how every device behaved before this existed.
        volumeCap: source.volume?.cap ?? null,
        volumeBoostMax: source.volume?.boost_max ?? null,
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

  /**
   * Build the explicit volume capability from a `volume:` block.
   *
   * `fully-kiosk` reuses the panel's existing content_control credentials rather
   * than asking for them twice — a panel has one password, and duplicating it in
   * a second block is how the two drift apart.
   */
  #createVolumeControl(source) {
    const config = source.volume;
    if (config.provider !== 'fully-kiosk') {
      this.#logger.warn?.('deviceFactory.unsupportedVolumeProvider', { provider: config.provider });
      return null;
    }
    if (!this.#httpClient) {
      this.#logger.warn?.('deviceFactory.noHttpClient');
      return null;
    }

    const content = source.content_control;
    if (content?.provider !== 'fully-kiosk') {
      this.#logger.warn?.('deviceFactory.volumeWithoutFullyKioskContent', {
        contentProvider: content?.provider ?? null,
      });
      return null;
    }

    let password = config.password || content.password;
    const authRef = config.auth_ref || content.auth_ref;
    if (!password && authRef && this.#configService) {
      password = this.#configService.getHouseholdAuth?.(authRef)?.password;
      if (!password) this.#logger.warn?.('deviceFactory.noAuthPassword', { auth_ref: authRef });
    }

    return this.#factories.fullyKioskVolume?.({
      host: config.host || content.host,
      port: config.port || content.port,
      password: password || '',
      stream: config.stream,
    }, { httpClient: this.#httpClient, logger: this.#logger }) ?? null;
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
