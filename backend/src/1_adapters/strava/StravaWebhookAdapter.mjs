/**
 * StravaWebhookAdapter
 *
 * Adapter that encapsulates all Strava webhook protocol knowledge:
 * - Challenge validation (GET with hub.* params)
 * - Event parsing (POST with object_type, object_id, etc.)
 * - Verify token checking
 *
 * The API layer calls identify() to check if a request is Strava,
 * then delegates to handleChallenge() or parseEvent() accordingly.
 *
 * @module adapters/strava/StravaWebhookAdapter
 */

/**
 * @typedef {Object} FitnessProviderEvent
 * @property {string} provider - 'strava'
 * @property {string} objectType - 'activity' | 'athlete'
 * @property {string|number} objectId - Activity or athlete ID
 * @property {string} aspectType - 'create' | 'update' | 'delete'
 * @property {number} ownerId - Athlete ID
 * @property {number} eventTime - Unix timestamp
 * @property {number} subscriptionId - Webhook subscription ID
 */

export class StravaWebhookAdapter {
  #verifyToken;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.verifyToken - Token for subscription validation
   * @param {Object} [config.logger]
   */
  constructor({ verifyToken, logger = console }) {
    this.#verifyToken = verifyToken;
    this.#logger = logger;
  }

  /**
   * Identify whether a request is a Strava webhook.
   * @param {Object} req - Express request
   * @returns {'challenge'|'event'|null}
   */
  identify(req) {
    if (req.method === 'GET' && req.query?.['hub.mode'] === 'subscribe') {
      return 'challenge';
    }
    if (req.method === 'POST' && req.body?.object_type && req.body?.subscription_id != null) {
      return 'event';
    }
    return null;
  }

  /**
   * Handle Strava subscription challenge validation.
   * @param {Object} query - req.query with hub.* params
   * @returns {{ ok: boolean, response?: Object, status?: number, reason?: string }}
   */
  handleChallenge(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe') {
      return { ok: false, status: 400, reason: 'invalid-mode' };
    }

    if (token !== this.#verifyToken) {
      this.#logger.warn?.('strava.webhook.challenge.token_mismatch');
      return { ok: false, status: 403, reason: 'token-mismatch' };
    }

    if (!challenge) {
      return { ok: false, status: 400, reason: 'missing-challenge' };
    }

    this.#logger.info?.('strava.webhook.challenge.validated');
    return { ok: true, response: { 'hub.challenge': challenge } };
  }

  /**
   * Parse a Strava webhook event into a generic FitnessProviderEvent.
   * @param {Object} body - req.body
   * @returns {FitnessProviderEvent|null}
   */
  parseEvent(body) {
    if (!body || typeof body !== 'object') return null;

    const { object_type, object_id, aspect_type, owner_id, event_time, subscription_id } = body;

    if (!object_type || object_id == null) {
      this.#logger.warn?.('strava.webhook.event.invalid_payload', { body });
      return null;
    }

    return {
      provider: 'strava',
      objectType: object_type,
      objectId: object_id,
      aspectType: aspect_type || 'create',
      ownerId: owner_id,
      eventTime: event_time,
      subscriptionId: subscription_id,
    };
  }

  /**
   * Check if an event should trigger enrichment.
   * @param {FitnessProviderEvent} event
   * @returns {boolean}
   */
  shouldEnrich(event) {
    return event?.objectType === 'activity' && event?.aspectType === 'create';
  }
}

export default StravaWebhookAdapter;
