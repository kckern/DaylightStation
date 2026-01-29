/**
 * DeviceFactory - Builds Device instances from configuration
 *
 * Reads device config and creates appropriate capability adapters
 * (HomeAssistant, FullyKiosk, SSH, WebSocket) based on provider settings.
 *
 * @module applications/devices/services
 */

import { Device } from './Device.mjs';
import { HomeAssistantDeviceAdapter } from '#adapters/devices/HomeAssistantDeviceAdapter.mjs';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';
import { WebSocketContentAdapter } from '#adapters/devices/WebSocketContentAdapter.mjs';
import { SshOsAdapter } from '#adapters/devices/SshOsAdapter.mjs';

export class DeviceFactory {
  #haGateway;
  #httpClient;
  #wsBus;
  #remoteExec;
  #daylightHost;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.haGateway - Home Assistant gateway
   * @param {Object} config.httpClient - HTTP client for API calls
   * @param {Object} config.wsBus - WebSocket broadcast service
   * @param {Object} config.remoteExec - Remote execution service
   * @param {string} config.daylightHost - Base URL for content loading
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
      capabilities.contentControl = this.#buildContentControl(deviceConfig.content_control);
    }

    return new Device(
      { id: deviceId, type: deviceConfig.type },
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

    // Transform display config for adapter
    const displays = {};
    for (const [displayId, displayConfig] of Object.entries(config.displays)) {
      displays[displayId] = {
        on_script: displayConfig.on_script,
        off_script: displayConfig.off_script,
        volume_script: displayConfig.volume_script,
        state_sensor: displayConfig.state_sensor
      };
    }

    return new HomeAssistantDeviceAdapter(
      { displays },
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

    return new SshOsAdapter(
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
  #buildContentControl(config) {
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

      return new FullyKioskContentAdapter(
        {
          host: config.host,
          port: config.port,
          password: password || '',
          daylightHost: this.#daylightHost
        },
        { httpClient: this.#httpClient, logger: this.#logger }
      );
    }

    if (provider === 'websocket') {
      if (!this.#wsBus) {
        this.#logger.warn?.('deviceFactory.noWsBus');
        return null;
      }

      return new WebSocketContentAdapter(
        {
          topic: config.topic,
          daylightHost: this.#daylightHost
        },
        { wsBus: this.#wsBus, logger: this.#logger }
      );
    }

    this.#logger.warn?.('deviceFactory.unsupportedContentProvider', { provider });
    return null;
  }
}

export default DeviceFactory;
