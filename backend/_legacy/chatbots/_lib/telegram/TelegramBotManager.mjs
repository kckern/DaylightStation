/**
 * Telegram Bot Manager
 * @module _lib/telegram/TelegramBotManager
 * 
 * Provides utilities for managing Telegram bots:
 * - Webhook registration and updates
 * - Slash command management (setMyCommands)
 * - Bot info retrieval
 */

import { createLogger } from '../logging/index.mjs';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Manager for Telegram Bot API administrative operations
 */
export class TelegramBotManager {
  #token;
  #botId;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.token - Bot token
   * @param {string} [config.botId] - Bot ID (optional, will be fetched if not provided)
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    if (!config?.token) {
      throw new Error('Bot token is required');
    }
    this.#token = config.token;
    this.#botId = config.botId || null;
    this.#logger = options.logger || createLogger({ source: 'telegram', app: 'bot-manager' });
  }

  /**
   * Make a Telegram Bot API request
   * @private
   */
  async #callApi(method, params = {}, httpMethod = 'POST') {
    const url = `${TELEGRAM_API_BASE}${this.#token}/${method}`;
    
    this.#logger.debug('telegram.botManager.request', { method });

    try {
      const options = {
        method: httpMethod,
        headers: { 'Content-Type': 'application/json' },
      };

      if (httpMethod === 'POST' && Object.keys(params).length > 0) {
        options.body = JSON.stringify(params);
      }

      const response = await fetch(url, options);
      const data = await response.json();

      if (!data.ok) {
        this.#logger.error('telegram.botManager.apiError', { 
          method, 
          error: data.description,
          errorCode: data.error_code,
        });
        throw new Error(data.description || 'Unknown Telegram API error');
      }

      this.#logger.debug('telegram.botManager.success', { method });
      return data.result;
    } catch (error) {
      this.#logger.error('telegram.botManager.error', { method, error: error.message });
      throw error;
    }
  }

  // ==================== Bot Info ====================

  /**
   * Get bot information
   * @returns {Promise<Object>}
   */
  async getMe() {
    return this.#callApi('getMe', {}, 'GET');
  }

  /**
   * Get the bot ID (fetches if not cached)
   * @returns {Promise<string>}
   */
  async getBotId() {
    if (this.#botId) return this.#botId;
    
    const me = await this.getMe();
    this.#botId = String(me.id);
    return this.#botId;
  }

  // ==================== Webhook Management ====================

  /**
   * Set webhook URL for the bot
   * @param {string} url - Webhook URL (must be HTTPS)
   * @param {Object} [options] - Additional webhook options
   * @param {string} [options.secretToken] - Secret token for webhook validation
   * @param {string[]} [options.allowedUpdates] - List of update types to receive
   * @param {number} [options.maxConnections] - Max simultaneous connections (1-100)
   * @param {boolean} [options.dropPendingUpdates] - Drop pending updates
   * @returns {Promise<boolean>}
   */
  async setWebhook(url, options = {}) {
    const params = { url };

    if (options.secretToken) {
      params.secret_token = options.secretToken;
    }
    if (options.allowedUpdates) {
      params.allowed_updates = options.allowedUpdates;
    }
    if (options.maxConnections) {
      params.max_connections = Math.min(100, Math.max(1, options.maxConnections));
    }
    if (options.dropPendingUpdates) {
      params.drop_pending_updates = true;
    }

    this.#logger.info('telegram.webhook.set', { url });
    return this.#callApi('setWebhook', params);
  }

  /**
   * Delete webhook (switch to getUpdates polling mode)
   * @param {Object} [options]
   * @param {boolean} [options.dropPendingUpdates] - Drop pending updates
   * @returns {Promise<boolean>}
   */
  async deleteWebhook(options = {}) {
    const params = {};
    if (options.dropPendingUpdates) {
      params.drop_pending_updates = true;
    }

    this.#logger.info('telegram.webhook.delete');
    return this.#callApi('deleteWebhook', params);
  }

  /**
   * Get current webhook info
   * @returns {Promise<Object>}
   */
  async getWebhookInfo() {
    return this.#callApi('getWebhookInfo', {}, 'GET');
  }

  // ==================== Command Management ====================

  /**
   * Set bot commands (slash commands)
   * @param {Array<{command: string, description: string}>} commands - Command list
   * @param {Object} [scope] - Command scope (default: all private chats)
   * @param {string} [languageCode] - Two-letter ISO 639-1 language code
   * @returns {Promise<boolean>}
   * 
   * @example
   * await manager.setCommands([
   *   { command: 'start', description: 'Start the bot' },
   *   { command: 'help', description: 'Show help' },
   *   { command: 'report', description: 'Generate daily report' },
   * ]);
   */
  async setCommands(commands, scope = null, languageCode = null) {
    // Validate commands
    const validatedCommands = commands.map(cmd => {
      const command = cmd.command.replace(/^\//, '').toLowerCase();
      if (!/^[a-z0-9_]{1,32}$/.test(command)) {
        throw new Error(`Invalid command name: ${command}. Must be 1-32 lowercase letters, digits, or underscores.`);
      }
      if (!cmd.description || cmd.description.length > 256) {
        throw new Error(`Invalid description for /${command}. Must be 1-256 characters.`);
      }
      return { command, description: cmd.description };
    });

    const params = { commands: validatedCommands };
    
    if (scope) {
      params.scope = scope;
    }
    if (languageCode) {
      params.language_code = languageCode;
    }

    this.#logger.info('telegram.commands.set', { 
      count: validatedCommands.length,
      commands: validatedCommands.map(c => c.command),
    });
    
    return this.#callApi('setMyCommands', params);
  }

  /**
   * Get current bot commands
   * @param {Object} [scope] - Command scope
   * @param {string} [languageCode] - Language code
   * @returns {Promise<Array<{command: string, description: string}>>}
   */
  async getCommands(scope = null, languageCode = null) {
    const params = {};
    if (scope) params.scope = scope;
    if (languageCode) params.language_code = languageCode;
    
    return this.#callApi('getMyCommands', params);
  }

  /**
   * Delete all bot commands
   * @param {Object} [scope] - Command scope
   * @param {string} [languageCode] - Language code
   * @returns {Promise<boolean>}
   */
  async deleteCommands(scope = null, languageCode = null) {
    const params = {};
    if (scope) params.scope = scope;
    if (languageCode) params.language_code = languageCode;
    
    this.#logger.info('telegram.commands.delete');
    return this.#callApi('deleteMyCommands', params);
  }

  // ==================== Convenience Methods ====================

  /**
   * Get full bot status including webhook and commands
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const [me, webhookInfo, commands] = await Promise.all([
      this.getMe(),
      this.getWebhookInfo(),
      this.getCommands(),
    ]);

    return {
      bot: {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
        canJoinGroups: me.can_join_groups,
        canReadGroupMessages: me.can_read_all_group_messages,
        supportsInlineQueries: me.supports_inline_queries,
      },
      webhook: {
        url: webhookInfo.url || null,
        hasCustomCertificate: webhookInfo.has_custom_certificate,
        pendingUpdateCount: webhookInfo.pending_update_count,
        lastErrorDate: webhookInfo.last_error_date 
          ? new Date(webhookInfo.last_error_date * 1000).toISOString() 
          : null,
        lastErrorMessage: webhookInfo.last_error_message || null,
        maxConnections: webhookInfo.max_connections,
        allowedUpdates: webhookInfo.allowed_updates || [],
      },
      commands: commands.map(c => `/${c.command} - ${c.description}`),
    };
  }

  /**
   * Switch webhook between dev and prod environments
   * @param {'dev'|'prod'} environment
   * @param {Object} webhooks - Webhook URLs by environment
   * @param {string} webhooks.dev - Development webhook URL
   * @param {string} webhooks.prod - Production webhook URL
   * @param {Object} [options] - Additional webhook options
   * @returns {Promise<Object>}
   */
  async switchEnvironment(environment, webhooks, options = {}) {
    if (!['dev', 'prod'].includes(environment)) {
      throw new Error('Environment must be "dev" or "prod"');
    }

    const url = webhooks[environment];
    if (!url) {
      throw new Error(`No webhook URL configured for environment: ${environment}`);
    }

    this.#logger.info('telegram.webhook.switch', { environment, url });
    
    await this.setWebhook(url, options);
    const info = await this.getWebhookInfo();

    return {
      environment,
      url,
      success: info.url === url,
      pendingUpdates: info.pending_update_count,
    };
  }
}

// ==================== Factory Functions ====================

/**
 * Create a TelegramBotManager from ConfigProvider
 * @param {import('../config/ConfigProvider.mjs').ConfigProvider} configProvider
 * @param {string} botName - 'nutribot' or 'journalist'
 * @returns {TelegramBotManager}
 */
export function createBotManagerFromConfig(configProvider, botName) {
  const token = configProvider.getTelegramToken(botName);
  const botId = configProvider.getTelegramBotId(botName);

  if (!token) {
    throw new Error(`No token found for bot: ${botName}`);
  }

  return new TelegramBotManager({ token, botId });
}

/**
 * Predefined command sets for different bots
 */
export const COMMAND_PRESETS = {
  nutribot: [
    { command: 'start', description: 'Start logging food' },
    { command: 'help', description: 'Show help and tips' },
    { command: 'report', description: 'Generate daily nutrition report' },
    { command: 'goals', description: 'View or update nutrition goals' },
    { command: 'undo', description: 'Undo last food log' },
    { command: 'clear', description: 'Clear today\'s logs (with confirmation)' },
  ],
  journalist: [
    { command: 'start', description: 'Start journaling' },
    { command: 'help', description: 'Show help' },
    { command: 'today', description: 'View today\'s entries' },
    { command: 'week', description: 'View this week\'s summary' },
    { command: 'prompt', description: 'Get a writing prompt' },
  ],
};

export default TelegramBotManager;
