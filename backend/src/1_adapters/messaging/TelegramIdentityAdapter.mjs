/**
 * TelegramIdentityAdapter
 * @module adapters/messaging/TelegramIdentityAdapter
 *
 * Telegram-specific identity resolution. Combines UserIdentityService (domain)
 * with TelegramChatRef to produce ResolvedIdentity with valid ConversationId.
 *
 * This is the ONLY place Telegram conversationIds should be constructed.
 */

import { TelegramChatRef } from '../telegram/TelegramChatRef.mjs';
import { ConversationId } from '#domains/messaging/value-objects/ConversationId.mjs';
import { ResolvedIdentity } from '#domains/messaging/value-objects/ResolvedIdentity.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

export class TelegramIdentityAdapter {
  #userIdentityService;
  #botConfigs;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/messaging/services/UserIdentityService.mjs').UserIdentityService} deps.userIdentityService
   * @param {Object} deps.botConfigs - Map of botName → { botId }
   * @param {Object} [deps.logger]
   */
  constructor({ userIdentityService, botConfigs, logger } = {}) {
    this.#userIdentityService = userIdentityService;
    this.#botConfigs = botConfigs || {};
    this.#logger = logger || console;
  }

  /**
   * Resolve identity for a Telegram bot interaction.
   *
   * @param {string} botName - 'nutribot', 'journalist', 'homebot'
   * @param {Object} input - At least one of: platformUserId, username, conversationId
   * @param {string} [input.platformUserId] - Telegram user ID
   * @param {string} [input.username] - System username
   * @param {string} [input.conversationId] - Existing conversationId string to parse
   * @returns {ResolvedIdentity}
   * @throws {ValidationError}
   */
  resolve(botName, { platformUserId, username, conversationId } = {}) {
    const botConfig = this.#botConfigs[botName];
    if (!botConfig?.botId) {
      throw new ValidationError(`No bot config found for "${botName}"`, {
        code: 'MISSING_BOT_CONFIG',
        botName,
      });
    }
    const { botId } = botConfig;

    // Resolve by platformUserId
    if (platformUserId) {
      const resolvedUsername = this.#userIdentityService.resolveUsername('telegram', platformUserId);
      const chatRef = new TelegramChatRef(botId, platformUserId);
      return new ResolvedIdentity({
        username: resolvedUsername,
        conversationId: chatRef.toConversationId(),
      });
    }

    // Resolve by username
    if (username) {
      const resolvedPlatformId = this.#userIdentityService.resolvePlatformId('telegram', username);
      if (!resolvedPlatformId) {
        throw new ValidationError(`Cannot resolve Telegram ID for username "${username}"`, {
          code: 'PLATFORM_ID_NOT_FOUND',
          username,
          platform: 'telegram',
        });
      }
      const chatRef = new TelegramChatRef(botId, resolvedPlatformId);
      return new ResolvedIdentity({
        username,
        conversationId: chatRef.toConversationId(),
      });
    }

    // Resolve by existing conversationId
    if (conversationId) {
      const parsed = ConversationId.parse(conversationId);
      const chatRef = TelegramChatRef.fromConversationId(parsed);
      const resolvedUsername = this.#userIdentityService.resolveUsername('telegram', chatRef.chatId);
      return new ResolvedIdentity({
        username: resolvedUsername,
        conversationId: parsed,
      });
    }

    throw new ValidationError('No resolvable input provided. Need platformUserId, username, or conversationId.', {
      code: 'NO_IDENTITY_INPUT',
    });
  }
}

export default TelegramIdentityAdapter;
