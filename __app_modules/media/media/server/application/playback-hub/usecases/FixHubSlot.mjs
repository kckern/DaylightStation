/**
 * FixHubSlot use case — the owner's one button for a hub slot.
 *
 * Asks the hub to repair the slot: reconnect its paired speaker on its own
 * adapter, restart the slot's player if it is wedged, and confirm audio is
 * moving — or, when BlueZ holds no bond, start a bounded (2 min) pairing scan
 * ("Hold the speaker's pairing button"). The hub answers with one plain line
 * in `result`; this use case returns it unchanged.
 *
 * Error policy: InfrastructureError from the gateway bubbles (router → 502/504).
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export class FixHubSlot {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {object} */ #logger;

  constructor({ gateway, logger } = {}) {
    if (!gateway) throw new Error('FixHubSlot: gateway required');
    this.#gateway = gateway;
    this.#logger = logger || console;
  }

  /**
   * @param {{ color: string }} input
   * @returns {Promise<{ok:boolean, code:string, result:string}>}
   */
  async execute({ color } = {}) {
    if (typeof color !== 'string' || color.length === 0) {
      throw new ValidationError('FixHubSlot.color must be a non-empty string', {
        code: 'INVALID_COLOR', field: 'color', value: color,
      });
    }
    this.#logger.info?.('playback-hub.fix.start', { color });
    const out = await this.#gateway.fixSlot(color);
    this.#logger.info?.('playback-hub.fix.result', {
      color, ok: out?.ok, code: out?.code, result: out?.result, status: out?.status,
    });
    return out;
  }
}

export default FixHubSlot;
