/**
 * Nutribot direct input
 * @module nutribot/application/services/NutribotDirectInput
 *
 * The direct-input routes (`/upc`, `/image`, and `/text` in its earlier
 * shape) log food and can call paid models on a plain HTTP request.
 * This decides who may use them, for which user, and counts each use against
 * the user's Nutribot day, the same day the quick inputs count against.
 *
 * A request is let through as one of three callers:
 *
 *   device    A household device (`X-Daylight-Device: fleet:<key>`) bound for
 *             Nutribot in the devices file (`quick_input.nutribot`). It must
 *             name the user, and may only name one it is bound to.
 *
 *   session   A signed-in user of the web app, acting for themselves, when
 *             the request also carries the header the app sends on every
 *             call. A session cookie alone rides along on a cross-site
 *             navigation; a custom header does not.
 *
 *   unbound   Anyone, on a route the household has opened to callers that
 *             cannot send a header (a barcode app), and
 *             only for the users listed for that route. Off unless set:
 *             `direct_input.allow_unbound.<route>: [<username>, ...]` in the
 *             nutribot app config. With no user named the first listed is
 *             used.
 *
 * There is no fallback to the head of household.
 */

import { QuickInputIntake, boundUsers, isBoundDevice } from '../../../../../../__capabilities/quick-input/server/public.mjs';

const BOT = 'nutribot';

/** The direct-input routes, and the operation each runs. */
export const DIRECT_ROUTES = Object.freeze({ upc: 'upc', image: 'image', text: 'text' });

const REFUSED = Object.freeze({ allowed: false, status: 403, reason: 'device_not_allowed' });
const names = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string' && name) : []);

export class NutribotDirectInput {
  #intakes;
  #deviceConfig;
  #unboundUsers;
  #resolveIdentity;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object|null} deps.ledger - Nutribot's quick-input ledger (the user's day)
   * @param {(deviceKey: string) => Object|null|undefined} deps.deviceConfig - A device's entry in the devices file
   * @param {(route: string) => string[]|undefined} deps.unboundUsers - `direct_input.allow_unbound.<route>`
   * @param {(username: string) => {username?: string, conversationIdString: string}} deps.resolveIdentity - May throw for an unknown user
   * @param {{upc: Function, image: Function, text: Function}} deps.operations - What each route runs
   * @param {() => number} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ ledger = null, deviceConfig, unboundUsers = () => undefined, resolveIdentity, operations = {}, clock = Date.now, logger = {} } = {}) {
    this.#deviceConfig = deviceConfig;
    this.#unboundUsers = unboundUsers;
    this.#resolveIdentity = resolveIdentity;
    this.#logger = logger;
    // One intake per operation, over the shared ledger: the allowance, the
    // attempt count and (when the caller sends an id) once-only processing.
    this.#intakes = ledger
      ? Object.fromEntries([...new Set(Object.values(DIRECT_ROUTES))].map((operation) => [operation, new QuickInputIntake({
          bot: BOT,
          kind: `direct-${operation}`,
          ledger,
          clock,
          logger,
          handler: { process: async (input) => ({ summary: { result: await operations[operation](input.body) } }) },
        })]))
      : null;
  }

  available() { return Boolean(this.#intakes); }

  /**
   * Whether this request may use the route, and for which user.
   * @param {Object} request
   * @param {string} request.route - 'upc' | 'image' | 'text'
   * @param {string|null} request.deviceId - The `X-Daylight-Device` value, if sent
   * @param {boolean} request.hasAppHeader - Whether the request carries the app's header at all
   * @param {string|null} request.sessionUser - The signed-in user, if the request carries a valid session
   * @param {string|null} request.requestedUser - The user the request names
   * @returns {{allowed: true, username: string, via: 'device'|'session'|'unbound'}
   *   | {allowed: false, status: number, reason: 'user_required'|'device_not_allowed'}}
   */
  authorize({ route, deviceId = null, hasAppHeader = false, sessionUser = null, requestedUser = null }) {
    const usersForDevice = (deviceKey) => this.#usersForDevice(deviceKey);

    // A device bound for Nutribot at all is held to its own list.
    if (isBoundDevice(deviceId, requestedUser || this.#anyBoundUser(deviceId), usersForDevice)) {
      if (!requestedUser) return { allowed: false, status: 400, reason: 'user_required' };
      return { allowed: true, username: requestedUser, via: 'device' };
    }
    if (this.#anyBoundUser(deviceId)) return REFUSED;

    if (sessionUser && hasAppHeader) {
      if (requestedUser && requestedUser !== sessionUser) return REFUSED;
      return { allowed: true, username: sessionUser, via: 'session' };
    }

    const open = names(this.#unboundUsers(route));
    if (open.length > 0) {
      if (!requestedUser) return { allowed: true, username: open[0], via: 'unbound' };
      if (open.includes(requestedUser)) return { allowed: true, username: requestedUser, via: 'unbound' };
    }
    return REFUSED;
  }

  /** The user's Nutribot conversation, or null when they have none. */
  context(username) {
    try {
      const identity = this.#resolveIdentity(username);
      if (!identity?.conversationIdString) return null;
      return { userId: identity.username || username, conversationId: identity.conversationIdString };
    } catch (error) {
      this.#logger.warn?.('nutribot.direct.identityResolutionFailed', { username, error: error.message });
      return null;
    }
  }

  /** Whether a request would be taken today, asked before it is run. */
  admission({ route, username, inputId = null, bytes = 0 }) {
    return this.#intakes[DIRECT_ROUTES[route]].admission({ username, inputId: inputId || 'not-yet-named', bytes });
  }

  /**
   * Run the route's operation for the user, counted against their day.
   * `inputId` is the caller's id for the request, if it sent one: the same id
   * on the same route runs once. With none, every request is its own input.
   * @returns {Promise<{kind: 'accepted', result: any} | {kind: 'duplicate'}
   *   | {kind: 'daily_limit', limit: string, retryAfterSeconds: number}>}
   */
  async run({ route, username, conversationId = null, inputId = null, command }) {
    const outcome = await this.#intakes[DIRECT_ROUTES[route]].execute({
      conversationId, username, inputId: inputId || `auto-${globalThis.crypto.randomUUID()}`, body: command,
    });
    if (outcome.kind === 'accepted') return { kind: 'accepted', result: outcome.result };
    if (outcome.kind === 'daily_limit') {
      return { kind: 'daily_limit', limit: outcome.limit, retryAfterSeconds: outcome.retryAfterSeconds };
    }
    return { kind: 'duplicate' };
  }

  #usersForDevice(deviceKey) {
    try {
      return boundUsers(this.#deviceConfig?.(deviceKey), BOT, 'direct');
    } catch (error) {
      this.#logger.warn?.('nutribot.direct.deviceLookupFailed', { deviceKey, error: error.message });
      return [];
    }
  }

  /** A user the named device is bound to for Nutribot, if it is bound at all. */
  #anyBoundUser(deviceId) {
    const match = /^fleet:([A-Za-z0-9._-]{1,96})$/.exec(String(deviceId ?? ''));
    return match ? this.#usersForDevice(match[1])[0] ?? null : null;
  }
}

export default NutribotDirectInput;
