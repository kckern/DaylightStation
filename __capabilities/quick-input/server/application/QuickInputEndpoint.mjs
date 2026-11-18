/**
 * Quick Input Endpoint
 * @module quick-input/application/QuickInputEndpoint
 *
 * What a quick-input route asks of a bot, answered from one intake and the
 * bot's own notions of who may send and where their conversation is.
 */

import { isBoundDevice } from './deviceBinding.mjs';

export class QuickInputEndpoint {
  #intake;
  #isAvailable;
  #deviceUsers;
  #resolveConversationId;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('./QuickInputIntake.mjs').QuickInputIntake|null} deps.intake - Null when the bot cannot take this kind
   * @param {() => boolean} [deps.isAvailable]
   * @param {(deviceKey: string) => string[]|undefined} deps.deviceUsers - Users a device is bound to for this bot and kind
   * @param {(username: string) => string|null} deps.resolveConversationId - May throw for an unknown user
   * @param {Object} [deps.logger]
   */
  constructor({ intake = null, isAvailable = () => true, deviceUsers = null, resolveConversationId, logger = {} } = {}) {
    this.#intake = intake;
    this.#isAvailable = isAvailable;
    this.#deviceUsers = deviceUsers;
    this.#resolveConversationId = resolveConversationId;
    this.#logger = logger;
  }

  available() { return Boolean(this.#intake) && Boolean(this.#isAvailable()); }

  deviceAllowed(deviceId, username) {
    try {
      return isBoundDevice(deviceId, username, this.#deviceUsers);
    } catch (error) {
      this.#logger.warn?.('quick_input.deviceLookupFailed', { deviceId, error: error.message });
      return false;
    }
  }

  /** The user's conversation with the bot, or null. There is no fallback to another user. */
  conversationFor(username) {
    if (!username) return null;
    try {
      return this.#resolveConversationId(username) || null;
    } catch (error) {
      this.#logger.warn?.('quick_input.identityResolutionFailed', {
        username, bot: this.#intake?.bot ?? null, error: error.message,
      });
      return null;
    }
  }

  admission(question) { return this.#intake.admission(question); }
  submit(command) { return this.#intake.execute(command); }
}

export default QuickInputEndpoint;
