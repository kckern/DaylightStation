// backend/src/0_system/registries/SystemBotLoader.mjs

import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';

/**
 * SystemBotLoader - Loads bot adapters based on system config
 *
 * Reads bot definitions from system/bots.yml and creates adapters with tokens
 * from system/auth/{platform}.yml. Provides lookup by app name and platform,
 * with household-specific platform selection via getHouseholdMessagingPlatform.
 *
 * Config sources:
 * - Bot definitions: system/bots.yml via configService.getSystemConfig('bots')
 * - Bot tokens: system/auth/{platform}.yml via configService.getSystemAuth(platform, appName)
 * - Household platform: configService.getHouseholdMessagingPlatform(householdId, appName)
 */
export class SystemBotLoader {
  #configService;
  #logger;
  #bots = new Map();  // appName -> Map<platform, adapter>

  /**
   * @param {Object} options
   * @param {ConfigService} options.configService - For config lookups
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ configService, logger = console }) {
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Load all bots from system config.
   * Iterates system/bots.yml and creates adapters for each platform.
   *
   * @param {Object} deps - Shared dependencies
   * @param {Object} deps.httpClient - HTTP client for API calls
   * @param {Object} [deps.transcriptionService] - Optional transcription service
   * @returns {number} Number of bots loaded
   */
  loadBots(deps = {}) {
    const botsConfig = this.#configService.getSystemConfig('bots');

    if (!botsConfig) {
      this.#logger.warn?.('bot.loader.no-config', {
        message: 'No bots config found in system config'
      });
      return 0;
    }

    let loadedCount = 0;

    for (const [appName, platforms] of Object.entries(botsConfig)) {
      if (!platforms || typeof platforms !== 'object') {
        this.#logger.warn?.('bot.loader.invalid-app-config', { appName });
        continue;
      }

      const appBots = new Map();

      for (const [platform, config] of Object.entries(platforms)) {
        try {
          const adapter = this.#createAdapter(platform, appName, config, deps);
          if (adapter) {
            appBots.set(platform, adapter);
            loadedCount++;
            this.#logger.info?.('bot.loader.loaded', { appName, platform });
          }
        } catch (error) {
          this.#logger.error?.('bot.loader.create-failed', {
            appName,
            platform,
            error: error.message
          });
        }
      }

      if (appBots.size > 0) {
        this.#bots.set(appName, appBots);
      }
    }

    this.#logger.info?.('bot.loader.complete', {
      totalBots: loadedCount,
      apps: [...this.#bots.keys()]
    });

    return loadedCount;
  }

  /**
   * Get a specific bot adapter by app name and platform.
   *
   * @param {string} appName - App name (nutribot, journalist, etc.)
   * @param {string} platform - Platform name (telegram, discord, etc.)
   * @returns {TelegramAdapter|null} Bot adapter or null if not found
   */
  getBot(appName, platform) {
    return this.#bots.get(appName)?.get(platform) ?? null;
  }

  /**
   * Get bot adapter based on household's configured platform for an app.
   * Uses configService.getHouseholdMessagingPlatform() to determine platform.
   *
   * @param {string} householdId - Household identifier
   * @param {string} appName - App name (nutribot, journalist, etc.)
   * @returns {TelegramAdapter|null} Bot adapter or null if not configured
   */
  getBotForHousehold(householdId, appName) {
    const platform = this.#configService.getHouseholdMessagingPlatform(householdId, appName);

    if (!platform) {
      this.#logger.debug?.('bot.loader.no-platform', { householdId, appName });
      return null;
    }

    const adapter = this.getBot(appName, platform);

    if (!adapter) {
      this.#logger.warn?.('bot.loader.adapter-not-found', {
        householdId,
        appName,
        platform
      });
    }

    return adapter;
  }

  /**
   * Get all loaded app names.
   * @returns {string[]}
   */
  getLoadedApps() {
    return [...this.#bots.keys()];
  }

  /**
   * Get all platforms configured for an app.
   * @param {string} appName - App name
   * @returns {string[]}
   */
  getPlatformsForApp(appName) {
    const appBots = this.#bots.get(appName);
    return appBots ? [...appBots.keys()] : [];
  }

  /**
   * Check if a bot is loaded for an app/platform combination.
   * @param {string} appName - App name
   * @param {string} platform - Platform name
   * @returns {boolean}
   */
  hasBot(appName, platform) {
    return this.#bots.get(appName)?.has(platform) ?? false;
  }

  /**
   * Create an adapter for a specific platform.
   * @private
   */
  #createAdapter(platform, appName, config, deps) {
    // Get auth from system auth config (may be string or object with token property)
    const auth = this.#configService.getSystemAuth(platform, appName);
    const token = typeof auth === 'string' ? auth : auth?.token;

    if (!token) {
      this.#logger.warn?.('bot.loader.no-token', { appName, platform });
      return null;
    }

    // Skip placeholder tokens
    if (token === 'PLACEHOLDER' || token.startsWith('PLACEHOLDER')) {
      this.#logger.debug?.('bot.loader.placeholder-token', { appName, platform });
      return null;
    }

    switch (platform) {
      case 'telegram':
        return new TelegramAdapter({
          token,
          secretToken: auth?.secret_token,
          httpClient: deps.httpClient,
          transcriptionService: deps.transcriptionService,
          logger: this.#logger
        });

      default:
        this.#logger.warn?.('bot.loader.unsupported-platform', {
          appName,
          platform
        });
        return null;
    }
  }
}

export default SystemBotLoader;
