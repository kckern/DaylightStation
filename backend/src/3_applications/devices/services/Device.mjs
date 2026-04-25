/**
 * Device - Aggregates device capabilities and routes commands
 *
 * A Device represents a controllable unit (TV, PC, etc.) with optional
 * capabilities: device_control, os_control, content_control.
 *
 * Volume routing: Checks device_control first, then os_control.
 *
 * @module applications/devices/services
 */

import { ApplicationError } from '#apps/common/errors/index.mjs';

/**
 * @typedef {Object} DeviceCapabilities
 * @property {Object|null} deviceControl - IDeviceControl implementation
 * @property {Object|null} osControl - IOsControl implementation
 * @property {Object|null} contentControl - IContentControl implementation
 */

export class Device {
  #id;
  #type;
  #defaultVolume;
  #screenPath;
  #deviceControl;
  #osControl;
  #contentControl;
  #volumeProvider;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.id - Device ID (e.g., 'livingroom-tv')
   * @param {string} config.type - Device type (e.g., 'shield-tv', 'linux-pc')
   * @param {DeviceCapabilities} capabilities
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor(config, capabilities, deps = {}) {
    if (!config?.id) {
      throw new ApplicationError('Device requires id', { code: 'INVALID_CONFIG' });
    }

    this.#id = config.id;
    this.#type = config.type || 'unknown';
    this.#defaultVolume = config.defaultVolume ?? null;
    this.#screenPath = config.screenPath || null;
    this.#deviceControl = capabilities.deviceControl || null;
    this.#osControl = capabilities.osControl || null;
    this.#contentControl = capabilities.contentControl || null;
    this.#logger = deps.logger || console;

    // Determine volume provider
    this.#volumeProvider = this.#determineVolumeProvider();
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Get device ID
   * @returns {string}
   */
  get id() {
    return this.#id;
  }

  /**
   * Get device type
   * @returns {string}
   */
  get type() {
    return this.#type;
  }

  /**
   * Get default volume level (from device config)
   * @returns {number|null}
   */
  get defaultVolume() {
    return this.#defaultVolume;
  }

  /**
   * Get screen path for content loading (e.g., '/screen/living-room').
   * Falls back to null if not configured (caller should default to '/tv').
   * @returns {string|null}
   */
  get screenPath() {
    return this.#screenPath;
  }

  /**
   * Power on device (all displays or specific display)
   * @param {string} [displayId] - Optional display ID
   * @returns {Promise<Object>}
   */
  async powerOn(displayId) {
    this.#logger.debug?.('device.powerOn.start', { id: this.#id, displayId, hasDeviceControl: !!this.#deviceControl });
    if (!this.#deviceControl) {
      this.#logger.warn?.('device.powerOn.noDeviceControl', { id: this.#id });
      return { ok: false, error: 'No device control configured' };
    }

    const result = await this.#deviceControl.powerOn(displayId);
    this.#logger.debug?.('device.powerOn.done', { id: this.#id, displayId, result });
    return result;
  }

  /**
   * Power off device (all displays or specific display)
   * @param {string} [displayId] - Optional display ID
   * @returns {Promise<Object>}
   */
  async powerOff(displayId) {
    if (!this.#deviceControl) {
      return { ok: false, error: 'No device control configured' };
    }

    this.#logger.info?.('device.powerOff', { id: this.#id, displayId });
    return this.#deviceControl.powerOff(displayId);
  }

  /**
   * Toggle device power
   * @param {string} [displayId] - Optional display ID
   * @returns {Promise<Object>}
   */
  async toggle(displayId) {
    if (!this.#deviceControl) {
      return { ok: false, error: 'No device control configured' };
    }

    this.#logger.info?.('device.toggle', { id: this.#id, displayId });
    return this.#deviceControl.toggle?.(displayId) || { ok: false, error: 'Toggle not supported' };
  }

  /**
   * Reboot device via ADB
   * @returns {Promise<Object>}
   */
  async reboot() {
    if (!this.#contentControl?.reboot) {
      return { ok: false, error: 'Reboot not supported for this device' };
    }

    this.#logger.info?.('device.reboot', { id: this.#id });
    return this.#contentControl.reboot();
  }

  /**
   * Set volume level
   * @param {number|string} level - Volume level (0-100, '+', '-', 'mute', 'unmute')
   * @returns {Promise<Object>}
   */
  async setVolume(level) {
    if (!this.#volumeProvider) {
      return { ok: false, error: 'Volume control not supported' };
    }

    this.#logger.info?.('device.setVolume', { id: this.#id, level, provider: this.#volumeProvider });

    if (this.#volumeProvider === 'device') {
      return this.#deviceControl.setVolume(level);
    } else if (this.#volumeProvider === 'os') {
      return this.#osControl.setVolume(level);
    }

    return { ok: false, error: 'Volume provider not found' };
  }

  /**
   * Set audio output device (for OS control)
   * @param {string} deviceName - Audio device name
   * @returns {Promise<Object>}
   */
  async setAudioDevice(deviceName) {
    if (!this.#osControl?.setAudioDevice) {
      return { ok: false, error: 'Audio device control not supported' };
    }

    this.#logger.info?.('device.setAudioDevice', { id: this.#id, deviceName });
    return this.#osControl.setAudioDevice(deviceName);
  }

  /**
   * Prepare device for content loading
   * @returns {Promise<Object>}
   */
  async prepareForContent() {
    this.#logger.debug?.('device.prepareForContent.start', { id: this.#id, hasContentControl: !!this.#contentControl });
    // For Fully Kiosk: screenOn + toForeground
    if (this.#contentControl?.prepareForContent) {
      const result = await this.#contentControl.prepareForContent();
      this.#logger.debug?.('device.prepareForContent.done', { id: this.#id, result });
      return result;
    }
    this.#logger.debug?.('device.prepareForContent.noop', { id: this.#id });
    return { ok: true };
  }

  /**
   * Load content on device
   * @param {string} path - Content path
   * @param {Object} [query] - Query parameters
   * @returns {Promise<Object>}
   */
  async loadContent(path, query = {}) {
    this.#logger.info?.('device.loadContent.start', { id: this.#id, path, query, hasContentControl: !!this.#contentControl });
    if (!this.#contentControl) {
      this.#logger.warn?.('device.loadContent.noContentControl', { id: this.#id });
      return { ok: false, error: 'No content control configured' };
    }

    const result = await this.#contentControl.load(path, query);
    this.#logger.info?.('device.loadContent.done', { id: this.#id, path, ok: result.ok, url: result.url });
    return result;
  }

  /**
   * Clear content by loading the device's configured Start URL.
   *
   * Delegates to `contentControl.loadStartUrl()` to return the device to its
   * kiosk/home state without rebooting or powering off. Used by the trigger
   * action handler to "clear" the screen on tag-off events.
   *
   * @returns {Promise<Object>}
   */
  async clearContent() {
    this.#logger.info?.('device.clearContent.start', { id: this.#id, hasContentControl: !!this.#contentControl });
    if (!this.#contentControl) {
      this.#logger.warn?.('device.clearContent.noContentControl', { id: this.#id });
      return { ok: false, error: 'No content control configured' };
    }
    if (typeof this.#contentControl.loadStartUrl !== 'function') {
      this.#logger.warn?.('device.clearContent.notSupported', { id: this.#id });
      return { ok: false, error: 'Content control does not support clear (loadStartUrl not implemented)' };
    }

    const result = await this.#contentControl.loadStartUrl();
    this.#logger.info?.('device.clearContent.done', { id: this.#id, ok: result.ok });
    return result;
  }

  /**
   * Get device state
   * @returns {Promise<Object>}
   */
  async getState() {
    const state = {
      id: this.#id,
      type: this.#type,
      capabilities: this.getCapabilities(),
      power: null,
      content: null
    };

    if (this.#deviceControl) {
      state.power = await this.#deviceControl.getState();
    }

    if (this.#contentControl) {
      state.content = await this.#contentControl.getStatus();
    }

    return state;
  }

  /**
   * Get device capabilities summary
   * @returns {Object}
   */
  getCapabilities() {
    return {
      deviceControl: !!this.#deviceControl,
      osControl: !!this.#osControl,
      contentControl: !!this.#contentControl,
      volume: this.#volumeProvider,
      audioDevice: !!(this.#osControl?.setAudioDevice)
    };
  }

  /**
   * Check if device supports a capability
   * @param {string} capability - 'deviceControl', 'osControl', 'contentControl', 'volume', 'audioDevice'
   * @returns {boolean}
   */
  hasCapability(capability) {
    const caps = this.getCapabilities();
    return !!caps[capability];
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Determine which provider handles volume
   * @private
   * @returns {'device'|'os'|null}
   */
  #determineVolumeProvider() {
    // Check device_control first (e.g., HA volume script)
    if (this.#deviceControl?.hasVolumeControl?.()) {
      return 'device';
    }

    // Then check os_control (e.g., SSH amixer)
    if (this.#osControl?.hasVolumeControl?.()) {
      return 'os';
    }

    return null;
  }
}

export default Device;
