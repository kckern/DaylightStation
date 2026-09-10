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
 * @property {Object|null} volumeControl - IVolumeControl implementation (explicit `volume:` block)
 */

/**
 * Coerce a configured percentage to an integer 0..100, or null when absent or
 * unusable. A malformed cap must read as "no cap configured" rather than as 0,
 * which would silently mute the device.
 * @param {any} value
 * @returns {number|null}
 */
function clampPercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export class Device {
  #id;
  #type;
  #name;
  #location;
  #icon;
  #videoCall;
  #defaultVolume;
  #screenPath;
  #notifyService;
  #deviceControl;
  #osControl;
  #contentControl;
  #volumeControl;
  #volumeCap;
  #volumeBoostMax;
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
    this.#name = config.name || null;
    this.#location = config.location || null;
    this.#icon = config.icon || null;
    this.#videoCall = config.videoCall === true;
    this.#defaultVolume = config.defaultVolume ?? null;
    this.#screenPath = config.screenPath || null;
    this.#notifyService = config.notifyService ?? null;
    this.#deviceControl = capabilities.deviceControl || null;
    this.#osControl = capabilities.osControl || null;
    this.#contentControl = capabilities.contentControl || null;
    this.#volumeControl = capabilities.volumeControl || null;
    this.#volumeCap = clampPercent(config.volumeCap);
    // The absolute ceiling. Defaults to the cap when unset, so a device that
    // declares a cap and no boost_max simply cannot be boosted — the safe
    // reading of a half-filled config.
    this.#volumeBoostMax = clampPercent(config.volumeBoostMax) ?? this.#volumeCap;
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
   * How a person names this device ("Living Room TV"), or null
   * @returns {string|null}
   */
  get name() {
    return this.#name;
  }

  /**
   * Where this device physically is, as a person would say it
   * @returns {string|null}
   */
  get location() {
    return this.#location;
  }

  /**
   * Emoji declared for this device in devices.yml
   * @returns {string|null}
   */
  get icon() {
    return this.#icon;
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
   * Falls back to null if not configured (caller should default to
   * '/screen/living-room'; the legacy '/tv' app is retired).
   * @returns {string|null}
   */
  get screenPath() {
    return this.#screenPath;
  }

  get notifyService() {
    return this.#notifyService;
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
   * Heal the companion audio bridge via the content control adapter.
   * Optional capability — returns { supported: false } when the underlying
   * content control does not implement it.
   * @param {Object} [opts] - Forwarded to contentControl.healAudioBridge (e.g. { force }).
   * @returns {Promise<Object>}
   */
  async healAudioBridge(opts = {}) {
    if (!this.#contentControl?.healAudioBridge) {
      return { ok: false, supported: false };
    }

    this.#logger.info?.('device.healAudioBridge', { id: this.#id, force: !!opts.force });
    return this.#contentControl.healAudioBridge(opts);
  }

  /**
   * Turn the device's display on or off via the content-control adapter.
   *
   * Display-only (FKB screenOn/screenOff) — distinct from powerOn/powerOff,
   * which drive device_control display power (e.g. HA TV scripts). Used by the
   * piano-kiosk screensaver where the tablet IS the display and FKB controls
   * its backlight. Optional capability — returns an error result when the
   * content control does not implement screen control.
   *
   * @param {boolean} on - true = screenOn, false = screenOff
   * @returns {Promise<Object>}
   */
  async setScreen(on) {
    if (!this.#contentControl) {
      return { ok: false, error: 'No content control configured' };
    }
    const method = on ? 'screenOn' : 'screenOff';
    if (typeof this.#contentControl[method] !== 'function') {
      return { ok: false, error: 'Screen control not supported for this device' };
    }
    this.#logger.info?.('device.setScreen', { id: this.#id, on });
    return this.#contentControl[method]();
  }

  /**
   * Read the device's real content-control status (for FKB: the live
   * `getDeviceInfo` → `{ ready, screenOn, currentUrl, ... }`).
   *
   * This is the VERIFY read that defeats FKB's 200/login silent-success: after a
   * screenOn/screenOff command, callers re-read the ACTUAL screen state rather
   * than trusting the command ack. Used by PianoScreenAuthorityService.
   *
   * Returns a `{ ready:false }` stub when no content control (or no getStatus)
   * is configured, so callers can treat "unknown" as not-ready without a throw.
   *
   * @returns {Promise<Object>|Object}
   */
  getStatus() {
    return this.#contentControl?.getStatus?.() ?? { ready: false, error: 'no status' };
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

    // The hard ceiling, enforced HERE rather than only in the fleet service, so
    // that no present or future caller can route around it. The fleet service
    // applies the everyday cap (and any live boost) on top of this; this is the
    // number that a boost itself may never exceed.
    const requested = level;
    const ceiling = this.#volumeBoostMax;
    if (ceiling !== null && typeof level === 'number' && level > ceiling) {
      level = ceiling;
    }
    const capped = level !== requested;

    this.#logger.info?.('device.setVolume', {
      id: this.#id, level, provider: this.#volumeProvider,
      ...(capped && { requested, cappedAt: ceiling }),
    });

    let result;
    if (this.#volumeProvider === 'explicit') {
      result = await this.#volumeControl.setVolume(level);
    } else if (this.#volumeProvider === 'device') {
      result = await this.#deviceControl.setVolume(level);
    } else if (this.#volumeProvider === 'os') {
      result = await this.#osControl.setVolume(level);
    } else {
      return { ok: false, error: 'Volume provider not found' };
    }

    return capped ? { ...result, level, requested, capped: true, cappedAt: ceiling } : result;
  }

  /**
   * Read the device's current hardware volume, where the provider supports it.
   * @returns {Promise<Object>}
   */
  async getVolume() {
    if (!this.#volumeControl?.getVolume) {
      return { ok: false, error: 'Volume read not supported' };
    }
    const result = await this.#volumeControl.getVolume();
    return { ...result, cap: this.#volumeCap, boostMax: this.#volumeBoostMax };
  }

  /**
   * The device's configured volume policy. Null cap means ungoverned.
   * @returns {{cap:number|null, boostMax:number|null}}
   */
  get volumePolicy() {
    return { cap: this.#volumeCap, boostMax: this.#volumeBoostMax };
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
   * @param {Object} [options] - Forwarded to the underlying IContentControl impl.
   *   See FullyKioskContentAdapter.prepareForContent for supported keys (e.g.
   *   `skipCameraCheck`).
   * @returns {Promise<Object>}
   */
  async prepareForContent(options = {}) {
    this.#logger.debug?.('device.prepareForContent.start', { id: this.#id, hasContentControl: !!this.#contentControl });
    // For Fully Kiosk: screenOn + toForeground
    if (this.#contentControl?.prepareForContent) {
      const result = await this.#contentControl.prepareForContent(options);
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
   * @param {Object} [options] - Adapter-level options forwarded to
   *   contentControl.load (e.g. `{ verifyAsync: true }` for fire-and-forget
   *   FKB URL verification on the wake-and-load path).
   * @returns {Promise<Object>}
   */
  async loadContent(path, query = {}, options = {}) {
    this.#logger.info?.('device.loadContent.start', { id: this.#id, path, query, hasContentControl: !!this.#contentControl });
    if (!this.#contentControl) {
      this.#logger.warn?.('device.loadContent.noContentControl', { id: this.#id });
      return { ok: false, error: 'No content control configured' };
    }

    const result = await this.#contentControl.load(path, query, options);
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
      // A camera-and-microphone screen that can be the far end of a Home Line
      // call. Content control alone is NOT this: every kiosk panel has it.
      videoCall: this.#videoCall && !!this.#contentControl,
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
    // An explicit `volume:` block wins. It is the only one of the three that was
    // configured to control audio and nothing else; the other two are inferred
    // from a display script or a shell that happens to have a mixer.
    if (this.#volumeControl?.hasVolumeControl?.()) {
      return 'explicit';
    }

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
