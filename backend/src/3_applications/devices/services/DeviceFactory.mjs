/**
 * DeviceFactory - Builds Device instances from configuration
 *
 * Reads device config and selects the appropriate capability adapter
 * (HomeAssistant, FullyKiosk, SSH, WebSocket) based on provider settings.
 * Concrete adapters are supplied by the composition root via
 * `adapterFactories` — this service holds selection logic only.
 *
 * @module applications/devices/services
 */

import { Device } from './Device.mjs';

export class DeviceFactory {
  #haGateway;
  #httpClient;
  #wsBus;
  #remoteExec;
  #daylightHost;
  #configService;
  #adapterFactories;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.haGateway - Home Assistant gateway
   * @param {Object} config.httpClient - HTTP client for API calls
   * @param {Object} config.wsBus - WebSocket broadcast service
   * @param {Object} config.remoteExec - Remote execution service
   * @param {string} config.daylightHost - Base URL for content loading
   * @param {Object} config.adapterFactories - Adapter factory fns from the
   *   composition root: { homeAssistantDevice, fullyKioskContent,
   *   webSocketContent, sshOs, adb, resilientContent }, each `(cfg, deps) => adapter`
   * @param {Object} [config.configService] - ConfigService for auth lookups
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#haGateway = config.haGateway;
    this.#httpClient = config.httpClient;
    this.#wsBus = config.wsBus;
    this.#remoteExec = config.remoteExec;
    this.#daylightHost = config.daylightHost;
    this.#configService = config.configService;
    this.#adapterFactories = config.adapterFactories || {};
    this.#logger = config.logger || console;
  }

  /**
   * Build a Device from configuration
   * @param {string} deviceId - Device identifier
   * @param {Object} deviceConfig - Device configuration
   * @returns {Promise<Device>}
   */
  async build(deviceId, deviceConfig) {
    this.#logger.debug?.('deviceFactory.build', { deviceId, type: deviceConfig.type });

    const capabilities = {
      deviceControl: null,
      osControl: null,
      contentControl: null
    };

    // Build device_control capability
    if (deviceConfig.device_control?.displays) {
      capabilities.deviceControl = this.#buildDeviceControl(deviceConfig.device_control);
    }

    // Build os_control capability
    if (deviceConfig.os_control) {
      capabilities.osControl = this.#buildOsControl(deviceConfig.os_control);
    }

    // Build content_control capability
    if (deviceConfig.content_control) {
      capabilities.contentControl = this.#buildContentControl(deviceId, deviceConfig.content_control, deviceConfig.camera_check);
    }

    return new Device(
      { id: deviceId, type: deviceConfig.type, defaultVolume: deviceConfig.default_volume, screenPath: deviceConfig.screen_path, notifyService: deviceConfig.notify_service ?? null },
      capabilities,
      { logger: this.#logger }
    );
  }

  /**
   * Build device control adapter
   * @private
   */
  #buildDeviceControl(config) {
    if (!this.#haGateway) {
      this.#logger.warn?.('deviceFactory.noHaGateway');
      return null;
    }

    // Transform display config for adapter.
    // Preserve powerOnRetries so IR-controlled displays (slow power-on) can override
    // the default retry count. state_sensor drives verify polling.
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

    // Device-level wait options apply to every display's verify-poll loop.
    // Omit if absent so the adapter's defaults (8s timeout / 1.5s poll) apply.
    const adapterConfig = { displays };
    if (config.powerOnWaitOptions) {
      adapterConfig.powerOnWaitOptions = config.powerOnWaitOptions;
    }
    if (config.waitOptions) {
      adapterConfig.waitOptions = config.waitOptions;
    }

    return this.#createAdapter('homeAssistantDevice',
      adapterConfig,
      { gateway: this.#haGateway, logger: this.#logger }
    );
  }

  /**
   * Build OS control adapter
   * @private
   */
  #buildOsControl(config) {
    if (config.provider !== 'ssh') {
      this.#logger.warn?.('deviceFactory.unsupportedOsProvider', { provider: config.provider });
      return null;
    }

    if (!this.#remoteExec) {
      this.#logger.warn?.('deviceFactory.noRemoteExec');
      return null;
    }

    return this.#createAdapter('sshOs',
      {
        host: config.host,
        user: config.user,
        port: config.port,
        commands: config.commands || {}
      },
      { remoteExec: this.#remoteExec, logger: this.#logger }
    );
  }

  /**
   * Build content control adapter
   * @private
   */
  #buildContentControl(deviceId, config, cameraCheck) {
    const provider = config.provider;

    if (provider === 'fully-kiosk') {
      if (!this.#httpClient) {
        this.#logger.warn?.('deviceFactory.noHttpClient');
        return null;
      }

      // Get password from auth_ref or directly from config
      let password = config.password;
      if (!password && config.auth_ref && this.#configService) {
        const auth = this.#configService.getHouseholdAuth?.(config.auth_ref);
        password = auth?.password;
        if (!password) {
          this.#logger.warn?.('deviceFactory.noAuthPassword', { auth_ref: config.auth_ref });
        }
      }

      // Create ADB adapter if fallback is configured (used for both
      // pre-emptive MIC release inside FK adapter and connection-error recovery)
      let adbAdapter = null;
      let launchActivity = null;
      if (config.fallback?.provider === 'adb') {
        adbAdapter = this.#createAdapter('adb',
          { host: config.fallback.host, port: config.fallback.port },
          { logger: this.#logger }
        );
        launchActivity = config.fallback.launch_activity;

        this.#logger.info?.('deviceFactory.resilientContentControl', {
          primary: 'fully-kiosk',
          fallback: 'adb',
          adbSerial: `${config.fallback.host}:${config.fallback.port}`
        });
      }

      const fkbAdapter = this.#createAdapter('fullyKioskContent',
        {
          host: config.host,
          port: config.port,
          password: password || '',
          daylightHost: this.#daylightHost,
          launchActivity,
          companionApps: config.companion_apps || [],
          cameraCheckPaths: cameraCheck?.paths
        },
        { httpClient: this.#httpClient, logger: this.#logger, adbAdapter }
      );

      // Wrap with ADB recovery if fallback is configured
      if (adbAdapter) {
        return this.#createAdapter('resilientContent',
          {
            primary: fkbAdapter,
            recovery: adbAdapter,
            launchActivity
          },
          { logger: this.#logger }
        );
      }

      return fkbAdapter;
    }

    if (provider === 'websocket') {
      if (!this.#wsBus) {
        this.#logger.warn?.('deviceFactory.noWsBus');
        return null;
      }

      return this.#createAdapter('webSocketContent',
        {
          topic: config.topic,
          deviceId,
          daylightHost: this.#daylightHost
        },
        { wsBus: this.#wsBus, logger: this.#logger }
      );
    }

    this.#logger.warn?.('deviceFactory.unsupportedContentProvider', { provider });
    return null;
  }

  /**
   * Invoke a composition-root-supplied adapter factory by name.
   * @private
   * @param {string} name - Factory key in adapterFactories
   * @param {Object} adapterConfig - Adapter-specific config
   * @param {Object} deps - Adapter-specific dependencies
   * @returns {Object|null} Adapter instance, or null if no factory registered
   */
  #createAdapter(name, adapterConfig, deps) {
    const factory = this.#adapterFactories[name];
    if (typeof factory !== 'function') {
      this.#logger.warn?.('deviceFactory.noAdapterFactory', { name });
      return null;
    }
    return factory(adapterConfig, deps);
  }
}

export default DeviceFactory;
