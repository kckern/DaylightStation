/**
 * ResolvedIdentity value object
 * @module domains/messaging/value-objects/ResolvedIdentity
 *
 * Represents a fully-resolved user identity: system username + valid ConversationId.
 * Immutable. Created by platform-specific identity adapters.
 */

import { ValidationError } from '../../core/errors/index.mjs';
import { ConversationId } from './ConversationId.mjs';

export class ResolvedIdentity {
  #username;
  #conversationId;

  /**
   * @param {Object} params
   * @param {string|null} params.username - System username, null if unknown
   * @param {ConversationId} params.conversationId - Valid domain ConversationId
   */
  constructor({ username = null, conversationId } = {}) {
    if (!conversationId || !(conversationId instanceof ConversationId)) {
      throw new ValidationError('conversationId is required and must be a ConversationId instance', {
        code: 'INVALID_IDENTITY',
      });
    }

    this.#username = username;
    this.#conversationId = conversationId;
    Object.freeze(this);
  }

  get username() { return this.#username; }
  get conversationId() { return this.#conversationId; }
  get conversationIdString() { return this.#conversationId.toString(); }

  toJSON() {
    return { username: this.#username, conversationId: this.#conversationId.toJSON() };
  }
}

export default ResolvedIdentity;
