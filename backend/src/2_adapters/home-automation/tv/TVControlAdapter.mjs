/**
 * TVControlAdapter - TV power and volume control via Home Assistant
 *
 * Orchestrates TV control through IHomeAutomationGateway.
 * Handles power on/off sequences with state polling and volume scripts.
 *
 * Expected Home Assistant entities (configurable):
 * - binary_sensor.{location}_tv_state - TV power state sensor
 * - script.{location}_tv_on - Turn on TV script
 * - script.{location}_tv_off - Turn off TV script
 * - script.{location}_tv_volume - Set TV volume script (optional)
 */

/**
 * @typedef {Object} TVLocation
 * @property {string} name - Location name (e.g., 'living_room', 'office')
 * @property {string} stateSensor - Entity ID for power state sensor
 * @property {string} onScript - Script to turn TV on
 * @property {string} offScript - Script to turn TV off
 * @property {string} [volumeScript] - Script to set volume (optional)
 */

/**
 * @typedef {Object} TVControlResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} location - Location name
 * @property {string} action - Action performed ('on', 'off', 'toggle', 'volume')
 * @property {string} previousState - State before operation
 * @property {string} currentState - State after operation
 * @property {number} elapsedMs - Time taken in milliseconds
 * @property {string} [error] - Error message if failed
 */

const DEFAULT_LOCATIONS = {
  living_room: {
    name: 'living_room',
    stateSensor: 'binary_sensor.living_room_tv_state',
    onScript: 'script.living_room_tv_on',
    offScript: 'script.living_room_tv_off',
    volumeScript: 'script.living_room_tv_volume'
  },
  office: {
    name: 'office',
    stateSensor: 'binary_sensor.office_tv_state',
    onScript: 'script.office_tv_on',
    offScript: 'script.office_tv_off',
    volumeScript: 'script.office_tv_volume'
  }
};

export class TVControlAdapter {
  #gateway;
  #locations;
  #defaultLocation;
  #logger;
  #waitOptions;
  #metrics;

  /**
   * @param {Object} config
   * @param {Object} config.gateway - IHomeAutomationGateway implementation
   * @param {Object} [config.locations] - Location configurations (defaults to living_room, office)
   * @param {string} [config.defaultLocation='living_room'] - Default location
   * @param {Object} [config.waitOptions] - Options for waitForState
   * @param {number} [config.waitOptions.timeoutMs=30000] - Max wait time
   * @param {number} [config.waitOptions.pollIntervalMs=2000] - Poll interval
   * @param {Object} [deps]
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    if (!config?.gateway) {
      throw new Error('TVControlAdapter requires gateway');
    }

    this.#gateway = config.gateway;
    this.#locations = { ...DEFAULT_LOCATIONS, ...config.locations };
    this.#defaultLocation = config.defaultLocation || 'living_room';
    this.#logger = deps.logger || console;
    this.#waitOptions = {
      timeoutMs: config.waitOptions?.timeoutMs ?? 30000,
      pollIntervalMs: config.waitOptions?.pollIntervalMs ?? 2000
    };

    this.#metrics = {
      startedAt: Date.now(),
      operations: {
        on: { attempts: 0, success: 0 },
        off: { attempts: 0, success: 0 },
        toggle: { attempts: 0, success: 0 },
        volume: { attempts: 0, success: 0 }
      },
      byLocation: {}
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Turn on TV
   * @param {string} [location] - Location name (defaults to defaultLocation)
   * @returns {Promise<TVControlResult>}
   */
  async turnOn(location) {
    const loc = this.#resolveLocation(location);
    if (!loc) {
      return this.#errorResult(location || this.#defaultLocation, 'on', 'Unknown location');
    }

    const startTime = Date.now();
    this.#recordAttempt('on', loc.name);

    this.#logger.info?.('tv.turnOn.start', { location: loc.name });

    try {
      // Check current state
      const state = await this.#gateway.getState(loc.stateSensor);
      const previousState = state?.state || 'unknown';

      // Already on? Just run volume script if available
      if (previousState === 'on') {
        this.#logger.debug?.('tv.turnOn.alreadyOn', { location: loc.name });

        if (loc.volumeScript) {
          await this.#gateway.runScript(loc.volumeScript);
        }

        this.#recordSuccess('on', loc.name);
        return this.#successResult(loc.name, 'on', previousState, 'on', startTime);
      }

      // Turn on and wait for state
      const scriptResult = await this.#gateway.runScript(loc.onScript);
      if (!scriptResult.ok) {
        return this.#errorResult(loc.name, 'on', scriptResult.error, previousState, startTime);
      }

      const waitResult = await this.#gateway.waitForState(
        loc.stateSensor,
        'on',
        this.#waitOptions
      );

      if (waitResult.reached) {
        this.#recordSuccess('on', loc.name);
        return this.#successResult(loc.name, 'on', previousState, 'on', startTime);
      } else {
        return this.#errorResult(
          loc.name,
          'on',
          `Timeout waiting for TV to turn on (final state: ${waitResult.finalState})`,
          previousState,
          startTime
        );
      }
    } catch (error) {
      this.#logger.error?.('tv.turnOn.error', { location: loc.name, error: error.message });
      return this.#errorResult(loc.name, 'on', error.message, 'unknown', startTime);
    }
  }

  /**
   * Turn off TV
   * @param {string} [location] - Location name
   * @returns {Promise<TVControlResult>}
   */
  async turnOff(location) {
    const loc = this.#resolveLocation(location);
    if (!loc) {
      return this.#errorResult(location || this.#defaultLocation, 'off', 'Unknown location');
    }

    const startTime = Date.now();
    this.#recordAttempt('off', loc.name);

    this.#logger.info?.('tv.turnOff.start', { location: loc.name });

    try {
      // Check current state
      const state = await this.#gateway.getState(loc.stateSensor);
      const previousState = state?.state || 'unknown';

      // Already off? Nothing to do
      if (previousState === 'off') {
        this.#logger.debug?.('tv.turnOff.alreadyOff', { location: loc.name });
        this.#recordSuccess('off', loc.name);
        return this.#successResult(loc.name, 'off', previousState, 'off', startTime);
      }

      // Turn off and wait for state
      const scriptResult = await this.#gateway.runScript(loc.offScript);
      if (!scriptResult.ok) {
        return this.#errorResult(loc.name, 'off', scriptResult.error, previousState, startTime);
      }

      const waitResult = await this.#gateway.waitForState(
        loc.stateSensor,
        'off',
        this.#waitOptions
      );

      if (waitResult.reached) {
        this.#recordSuccess('off', loc.name);
        return this.#successResult(loc.name, 'off', previousState, 'off', startTime);
      } else {
        return this.#errorResult(
          loc.name,
          'off',
          `Timeout waiting for TV to turn off (final state: ${waitResult.finalState})`,
          previousState,
          startTime
        );
      }
    } catch (error) {
      this.#logger.error?.('tv.turnOff.error', { location: loc.name, error: error.message });
      return this.#errorResult(loc.name, 'off', error.message, 'unknown', startTime);
    }
  }

  /**
   * Toggle TV power
   * @param {string} [location] - Location name
   * @returns {Promise<TVControlResult>}
   */
  async toggle(location) {
    const loc = this.#resolveLocation(location);
    if (!loc) {
      return this.#errorResult(location || this.#defaultLocation, 'toggle', 'Unknown location');
    }

    this.#recordAttempt('toggle', loc.name);

    this.#logger.info?.('tv.toggle.start', { location: loc.name });

    try {
      const state = await this.#gateway.getState(loc.stateSensor);
      const currentState = state?.state || 'unknown';

      if (currentState === 'on') {
        const result = await this.turnOff(loc.name);
        result.action = 'toggle';
        if (result.ok) this.#recordSuccess('toggle', loc.name);
        return result;
      } else {
        const result = await this.turnOn(loc.name);
        result.action = 'toggle';
        if (result.ok) this.#recordSuccess('toggle', loc.name);
        return result;
      }
    } catch (error) {
      this.#logger.error?.('tv.toggle.error', { location: loc.name, error: error.message });
      return this.#errorResult(loc.name, 'toggle', error.message);
    }
  }

  /**
   * Get current TV state
   * @param {string} [location] - Location name
   * @returns {Promise<{location: string, state: string, lastChanged: string} | null>}
   */
  async getState(location) {
    const loc = this.#resolveLocation(location);
    if (!loc) return null;

    const state = await this.#gateway.getState(loc.stateSensor);
    if (!state) return null;

    return {
      location: loc.name,
      state: state.state,
      lastChanged: state.lastChanged
    };
  }

  /**
   * Run volume script (typically sets to default volume)
   * @param {string} [location] - Location name
   * @returns {Promise<TVControlResult>}
   */
  async setVolume(location) {
    const loc = this.#resolveLocation(location);
    if (!loc) {
      return this.#errorResult(location || this.#defaultLocation, 'volume', 'Unknown location');
    }

    if (!loc.volumeScript) {
      return this.#errorResult(loc.name, 'volume', 'No volume script configured');
    }

    const startTime = Date.now();
    this.#recordAttempt('volume', loc.name);

    this.#logger.info?.('tv.setVolume', { location: loc.name });

    try {
      const result = await this.#gateway.runScript(loc.volumeScript);

      if (result.ok) {
        this.#recordSuccess('volume', loc.name);
        return this.#successResult(loc.name, 'volume', 'n/a', 'n/a', startTime);
      } else {
        return this.#errorResult(loc.name, 'volume', result.error, 'n/a', startTime);
      }
    } catch (error) {
      this.#logger.error?.('tv.setVolume.error', { location: loc.name, error: error.message });
      return this.#errorResult(loc.name, 'volume', error.message, 'n/a', startTime);
    }
  }

  /**
   * Get list of configured locations
   * @returns {string[]}
   */
  getLocations() {
    return Object.keys(this.#locations);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    const uptimeMs = Date.now() - this.#metrics.startedAt;
    return {
      uptime: {
        ms: uptimeMs,
        formatted: this.#formatDuration(uptimeMs)
      },
      operations: this.#metrics.operations,
      byLocation: this.#metrics.byLocation,
      locations: this.getLocations()
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Resolve location config
   * @private
   */
  #resolveLocation(location) {
    const name = location || this.#defaultLocation;
    return this.#locations[name] || null;
  }

  /**
   * Record operation attempt
   * @private
   */
  #recordAttempt(action, location) {
    this.#metrics.operations[action].attempts++;

    if (!this.#metrics.byLocation[location]) {
      this.#metrics.byLocation[location] = { attempts: 0, success: 0 };
    }
    this.#metrics.byLocation[location].attempts++;
  }

  /**
   * Record operation success
   * @private
   */
  #recordSuccess(action, location) {
    this.#metrics.operations[action].success++;
    this.#metrics.byLocation[location].success++;
  }

  /**
   * Build success result
   * @private
   */
  #successResult(location, action, previousState, currentState, startTime) {
    return {
      ok: true,
      location,
      action,
      previousState,
      currentState,
      elapsedMs: Date.now() - startTime
    };
  }

  /**
   * Build error result
   * @private
   */
  #errorResult(location, action, error, previousState = 'unknown', startTime = Date.now()) {
    return {
      ok: false,
      location,
      action,
      previousState,
      currentState: 'unknown',
      elapsedMs: Date.now() - startTime,
      error
    };
  }

  /**
   * Format duration
   * @private
   */
  #formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default TVControlAdapter;
