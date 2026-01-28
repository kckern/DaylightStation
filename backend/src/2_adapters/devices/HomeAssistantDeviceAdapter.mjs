/**
 * HomeAssistantDeviceAdapter - Device control via Home Assistant scripts
 *
 * Implements IDeviceControl port using Home Assistant scripts for power control.
 * Supports multiple displays per device with configurable on/off/volume scripts.
 *
 * @module adapters/devices
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * @typedef {Object} DisplayConfig
 * @property {string} provider - Always 'homeassistant'
 * @property {string} on_script - Script entity to turn on display
 * @property {string} off_script - Script entity to turn off display
 * @property {string} [volume_script] - Script entity to set volume
 */

export class HomeAssistantDeviceAdapter {
  #gateway;
  #displays;
  #logger;
  #waitOptions;
  #metrics;

  /**
   * @param {Object} config
   * @param {Object.<string, DisplayConfig>} config.displays - Display configurations keyed by display ID
   * @param {Object} deps
   * @param {Object} deps.gateway - IHomeAutomationGateway implementation
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!deps.gateway) {
      throw new InfrastructureError('HomeAssistantDeviceAdapter requires gateway', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'gateway'
      });
    }

    this.#gateway = deps.gateway;
    this.#displays = config.displays || {};
    this.#logger = deps.logger || console;
    this.#waitOptions = {
      timeoutMs: config.waitOptions?.timeoutMs ?? 30000,
      pollIntervalMs: config.waitOptions?.pollIntervalMs ?? 2000
    };

    this.#metrics = {
      startedAt: Date.now(),
      operations: { on: 0, off: 0 }
    };
  }

  // =============================================================================
  // IDeviceControl Implementation
  // =============================================================================

  /**
   * Power on displays
   * @param {string} [displayId] - Specific display, or all if not specified
   * @returns {Promise<Object>}
   */
  async powerOn(displayId) {
    const startTime = Date.now();

    if (displayId) {
      const display = this.#displays[displayId];
      if (!display) {
        return { ok: false, error: `Display '${displayId}' not found` };
      }
      return this.#powerOnDisplay(displayId, display, startTime);
    }

    // Power on all displays
    const results = await Promise.all(
      Object.entries(this.#displays).map(([id, config]) =>
        this.#powerOnDisplay(id, config, startTime)
      )
    );

    const allOk = results.every(r => r.ok);
    this.#metrics.operations.on++;

    return {
      ok: allOk,
      displays: results,
      elapsedMs: Date.now() - startTime
    };
  }

  /**
   * Power off displays
   * @param {string} [displayId] - Specific display, or all if not specified
   * @returns {Promise<Object>}
   */
  async powerOff(displayId) {
    const startTime = Date.now();

    if (displayId) {
      const display = this.#displays[displayId];
      if (!display) {
        return { ok: false, error: `Display '${displayId}' not found` };
      }
      return this.#powerOffDisplay(displayId, display, startTime);
    }

    // Power off all displays
    const results = await Promise.all(
      Object.entries(this.#displays).map(([id, config]) =>
        this.#powerOffDisplay(id, config, startTime)
      )
    );

    const allOk = results.every(r => r.ok);
    this.#metrics.operations.off++;

    return {
      ok: allOk,
      displays: results,
      elapsedMs: Date.now() - startTime
    };
  }

  /**
   * Get state of all displays
   * @returns {Promise<Object>}
   */
  async getState() {
    const displayStates = {};

    for (const [displayId, config] of Object.entries(this.#displays)) {
      if (config.state_sensor) {
        const state = await this.#gateway.getState(config.state_sensor);
        displayStates[displayId] = state?.state || 'unknown';
      } else {
        displayStates[displayId] = 'unknown';
      }
    }

    return {
      state: Object.values(displayStates).includes('on') ? 'on' : 'off',
      displays: displayStates
    };
  }

  /**
   * Set volume via HA script
   * @param {number} level - Volume level 0-100
   * @returns {Promise<Object>}
   */
  async setVolume(level) {
    // Find first display with volume script
    for (const [displayId, config] of Object.entries(this.#displays)) {
      if (config.volume_script) {
        this.#logger.info?.('device.ha.setVolume', { displayId, level });
        const result = await this.#gateway.runScript(config.volume_script);
        return {
          ok: result.ok,
          displayId,
          level,
          error: result.error
        };
      }
    }

    return { ok: false, error: 'No volume script configured' };
  }

  /**
   * Check if this adapter provides volume control
   * @returns {boolean}
   */
  hasVolumeControl() {
    return Object.values(this.#displays).some(d => d.volume_script);
  }

  /**
   * Get list of display IDs
   * @returns {string[]}
   */
  getDisplayIds() {
    return Object.keys(this.#displays);
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Power on a single display
   * @private
   */
  async #powerOnDisplay(displayId, config, startTime) {
    this.#logger.info?.('device.ha.powerOn', { displayId, script: config.on_script });

    const result = await this.#gateway.runScript(config.on_script);

    return {
      ok: result.ok,
      displayId,
      action: 'on',
      elapsedMs: Date.now() - startTime,
      error: result.error
    };
  }

  /**
   * Power off a single display
   * @private
   */
  async #powerOffDisplay(displayId, config, startTime) {
    this.#logger.info?.('device.ha.powerOff', { displayId, script: config.off_script });

    const result = await this.#gateway.runScript(config.off_script);

    return {
      ok: result.ok,
      displayId,
      action: 'off',
      elapsedMs: Date.now() - startTime,
      error: result.error
    };
  }
}

export default HomeAssistantDeviceAdapter;
