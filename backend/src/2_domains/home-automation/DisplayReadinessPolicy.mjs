// backend/src/2_domains/home-automation/DisplayReadinessPolicy.mjs

/**
 * DisplayReadinessPolicy — domain logic for "is a display ready for content?"
 *
 * Consumes IDisplayPowerCheck port. Encapsulates the business rule so it lives
 * in the domain layer, not scattered across adapters and routers.
 *
 * @module domains/home-automation
 */

export class DisplayReadinessPolicy {
  #powerCheck;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.powerCheck - IDisplayPowerCheck implementation
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#powerCheck = deps.powerCheck;
    this.#logger = deps.logger || console;
  }

  /**
   * Is the display ready to receive content?
   *
   * @param {string} deviceId - Device identifier (for logging)
   * @returns {Promise<{ready: boolean, reason?: string, detail: Object}>}
   */
  async isReady(deviceId) {
    const result = await this.#powerCheck.isDisplayOn(deviceId);

    this.#logger.debug?.('display-readiness.check', { deviceId, ...result });

    if (result.source === 'none') {
      return {
        ready: false,
        reason: 'no_sensor',
        detail: result
      };
    }

    if (result.on) {
      return { ready: true, detail: result };
    }

    return {
      ready: false,
      reason: 'display_off',
      detail: result
    };
  }
}
