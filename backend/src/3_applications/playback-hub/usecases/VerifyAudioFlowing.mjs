/**
 * VerifyAudioFlowing use case.
 *
 * Asks the gateway to sample the BT sink's PipeWire monitor port and report
 * back whether real audio samples are flowing. Returns the gateway response
 * unchanged — callers (the API router) serialize it onto the wire.
 *
 * Input validation:
 *   - color must be a non-empty string → otherwise ValidationError.
 *
 * Error policy:
 *   - InfrastructureError from the gateway bubbles up (the router maps it
 *     to 502/504 per its standard mapping).
 *   - All other errors bubble too.
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export class VerifyAudioFlowing {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   gateway: import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   logger?: object
   * }} deps
   */
  constructor({ gateway, logger } = {}) {
    if (!gateway) throw new Error('VerifyAudioFlowing: gateway required');
    this.#gateway = gateway;
    this.#logger = logger || console;
  }

  /**
   * @param {{ color: string }} input
   * @returns {Promise<object>}
   */
  async execute({ color } = {}) {
    if (typeof color !== 'string' || color.length === 0) {
      throw new ValidationError('VerifyAudioFlowing.color must be a non-empty string', {
        code: 'INVALID_COLOR', field: 'color', value: color,
      });
    }
    const result = await this.#gateway.verifyAudio(color);
    this.#logger.debug?.('playback-hub.verify.completed', {
      color,
      audio_flowing: result?.audio_flowing,
      peak_dbfs: result?.peak_dbfs,
      bt_connected: result?.bt_connected,
    });
    return result;
  }
}

export default VerifyAudioFlowing;
