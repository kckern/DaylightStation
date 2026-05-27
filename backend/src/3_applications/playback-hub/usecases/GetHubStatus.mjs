/**
 * GetHubStatus use case.
 *
 * Returns the live slot statuses from the playback hub. Used by both the
 * `GET /api/v1/playback-hub/status` route (immediate first-paint) and the
 * `HubStatusBroadcaster` (every 3s loop).
 *
 * No title enrichment here — the frontend resolves titles per row via the
 * existing `/api/v1/info/:source/:id` endpoint (see the design's "frontend
 * layout" section). Keeps this bounded context free of cross-context
 * content-metadata dependency.
 */

export class GetHubStatus {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   headsetHubGateway: import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   logger?: object
   * }} deps
   */
  constructor({ headsetHubGateway, logger } = {}) {
    if (!headsetHubGateway) {
      throw new Error('GetHubStatus: headsetHubGateway required');
    }
    this.#gateway = headsetHubGateway;
    this.#logger = logger || console;
  }

  /**
   * @returns {Promise<{ slots: object[], fetchedAt: Date }>}
   */
  async execute() {
    const slots = await this.#gateway.getStatus();
    return { slots, fetchedAt: new Date() };
  }
}

export default GetHubStatus;
