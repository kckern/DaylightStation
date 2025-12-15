/**
 * Configuration Provider
 * @module _lib/config/ConfigProvider
 * 
 * Centralized configuration loading for chatbots.
 * Loads from config.app.yml, config.secrets.yml, and environment variables.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default search paths for config files (relative to project root)
 */
const CONFIG_SEARCH_PATHS = [
  // From chatbots/_lib/config/
  path.resolve(__dirname, '../../../../config.app.yml'),
  path.resolve(__dirname, '../../../../config.app-local.yml'),
  // From project root
  path.resolve(process.cwd(), 'config.app.yml'),
  path.resolve(process.cwd(), 'config.app-local.yml'),
];

const SECRETS_SEARCH_PATHS = [
  path.resolve(__dirname, '../../../../config.secrets.yml'),
  path.resolve(process.cwd(), 'config.secrets.yml'),
];

/**
 * Configuration Provider
 * Provides typed access to chatbot configuration
 */
export class ConfigProvider {
  #appConfig;
  #secrets;
  #env;

  /**
   * @param {Object} [options]
   * @param {string} [options.appConfigPath] - Override path to config.app.yml
   * @param {string} [options.secretsPath] - Override path to config.secrets.yml
   * @param {Object} [options.env] - Override environment variables (for testing)
   */
  constructor(options = {}) {
    this.#env = options.env || process.env;
    this.#appConfig = this.#loadAppConfig(options.appConfigPath);
    this.#secrets = this.#loadSecrets(options.secretsPath);
  }

  // ==================== Loaders ====================

  /**
   * Load app config from file
   * @private
   */
  #loadAppConfig(overridePath) {
    if (overridePath) {
      return this.#loadYamlFile(overridePath);
    }

    // Try local config first (for development overrides)
    for (const p of CONFIG_SEARCH_PATHS) {
      if (p.includes('-local.yml') && fs.existsSync(p)) {
        const localConfig = this.#loadYamlFile(p);
        // Merge with base config
        const basePath = p.replace('-local.yml', '.yml');
        if (fs.existsSync(basePath)) {
          const baseConfig = this.#loadYamlFile(basePath);
          return this.#deepMerge(baseConfig, localConfig);
        }
        return localConfig;
      }
    }

    // Fall back to base config
    for (const p of CONFIG_SEARCH_PATHS) {
      if (!p.includes('-local.yml') && fs.existsSync(p)) {
        return this.#loadYamlFile(p);
      }
    }

    return {};
  }

  /**
   * Load secrets from file
   * @private
   */
  #loadSecrets(overridePath) {
    if (overridePath) {
      return this.#loadYamlFile(overridePath);
    }

    for (const p of SECRETS_SEARCH_PATHS) {
      if (fs.existsSync(p)) {
        return this.#loadYamlFile(p);
      }
    }

    return {};
  }

  /**
   * Load and parse a YAML file
   * @private
   */
  #loadYamlFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) || {};
    } catch (error) {
      console.warn(`ConfigProvider: Failed to load ${filePath}: ${error.message}`);
      return {};
    }
  }

  /**
   * Deep merge two objects
   * @private
   */
  #deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.#deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // ==================== General Config ====================

  /**
   * Get timezone
   * @returns {string}
   */
  getTimezone() {
    return this.#appConfig.weather?.timezone 
      || this.#env.TZ 
      || 'America/Los_Angeles';
  }

  /**
   * Get environment (production, development, test)
   * @returns {string}
   */
  getEnvironment() {
    return this.#env.NODE_ENV || 'development';
  }

  /**
   * Check if running in production
   * @returns {boolean}
   */
  isProduction() {
    return this.getEnvironment() === 'production';
  }

  /**
   * Get raw app config (for advanced access)
   * @returns {Object}
   */
  getAppConfig() {
    return this.#appConfig;
  }

  // ==================== User Management ====================

  /**
   * Get user config by internal user ID
   * @param {string} internalUserId - Internal user ID (e.g., 'kckern')
   * @returns {Object|null}
   */
  getUser(internalUserId) {
    const users = this.#appConfig.chatbots?.users || {};
    const user = users[internalUserId];
    if (!user) return null;
    
    return {
      internalId: internalUserId,
      telegramUserId: String(user.telegram_user_id || ''),
      defaultBot: user.default_bot || 'nutribot',
      goals: user.goals || this.getNutritionGoals(),
    };
  }

  /**
   * Get internal user ID from Telegram user ID
   * @param {string|number} telegramUserId - Telegram user ID
   * @returns {string|null}
   */
  getInternalUserId(telegramUserId) {
    const users = this.#appConfig.chatbots?.users || {};
    const telegramId = String(telegramUserId);
    
    for (const [internalId, user] of Object.entries(users)) {
      if (String(user.telegram_user_id) === telegramId) {
        return internalId;
      }
    }
    return null;
  }

  /**
   * Get all registered users
   * @returns {Object[]}
   */
  getAllUsers() {
    const users = this.#appConfig.chatbots?.users || {};
    return Object.entries(users).map(([internalId, user]) => ({
      internalId,
      telegramUserId: String(user.telegram_user_id || ''),
      defaultBot: user.default_bot || 'nutribot',
      goals: user.goals || this.getNutritionGoals(),
    }));
  }

  /**
   * Get nutrition goals for a specific user
   * @param {string} internalUserId - Internal user ID
   * @returns {Object}
   */
  getUserGoals(internalUserId) {
    const user = this.getUser(internalUserId);
    return user?.goals || this.getNutritionGoals();
  }

  // ==================== Bot Configuration ====================

  /**
   * Get bot configuration
   * @param {string} botName - 'nutribot' or 'journalist'
   * @returns {Object}
   */
  getBotConfig(botName) {
    const chatbots = this.#appConfig.chatbots || {};
    const bot = chatbots.bots?.[botName] || {};
    const webhookEnv = this.isProduction() ? 'prod' : 'dev';
    
    return {
      name: botName,
      telegramBotId: String(bot.telegram_bot_id || this.#getLegacyBotId(botName)),
      token: this.getTelegramToken(botName),
      webhookUrl: bot.webhooks?.[webhookEnv] || this.#getLegacyWebhookUrl(botName),
      reportHost: bot.report_host || null,
    };
  }

  /**
   * Get legacy bot ID (for backwards compatibility)
   * @private
   */
  #getLegacyBotId(botName) {
    const journalist = this.#appConfig.journalist || {};
    switch (botName) {
      case 'nutribot':
        return journalist.nutribot_telegram_bot_id || '6898194425';
      case 'journalist':
        return journalist.journalist_telegram_bot_id || '580626020';
      default:
        return '';
    }
  }

  /**
   * Get legacy webhook URL (for backwards compatibility)
   * @private
   */
  #getLegacyWebhookUrl(botName) {
    const journalist = this.#appConfig.journalist || {};
    const isProd = this.isProduction();
    
    switch (botName) {
      case 'nutribot':
        return isProd 
          ? journalist.nutribot_prod_hook || 'https://daylightstation-api.kckern.net/foodlog'
          : journalist.nutribot_dev_hook || 'https://api-dev.kckern.net/foodlog';
      case 'journalist':
        return isProd
          ? journalist.journalist_prod_hook || 'https://daylightstation-api.kckern.net/journalist'
          : journalist.journalist_dev_hook || 'https://api-dev.kckern.net/journalist';
      default:
        return '';
    }
  }

  // ==================== NutriBot Config ====================

  /**
   * Get NutriBot configuration
   * @returns {Object}
   */
  getNutribotConfig() {
    const bot = this.getBotConfig('nutribot');
    const chatbots = this.#appConfig.chatbots || {};
    const data = chatbots.data?.nutribot || {};
    
    // Legacy fallbacks
    const legacyNutribot = this.#appConfig.nutribot || {};
    const legacyJournalist = this.#appConfig.journalist || {};
    
     return {
      telegram: {
        botId: bot.telegramBotId,
        token: bot.token,
        webhookUrl: bot.webhookUrl,
      },
      users: {
        defaultUserId: String(legacyJournalist.journalist_user_id || '575596036'),
      },
      data: {
        nutrilogPath: data.nutrilog || legacyNutribot.data?.nutrilogPath || 'lifelog/nutribot/nutrilog',
        nutrilistPath: data.nutrilist || legacyNutribot.data?.nutrilistPath || 'lifelog/nutribot/nutrilist',
      },
      goals: this.getNutritionGoals(),
      report: {
        host: bot.reportHost || this.#appConfig.nutribot_report_host || 'https://daylightstation-api.kckern.net',
        timezone: this.getTimezone(),
      },
      legacyChatId: this.#appConfig.nutribot_chat_id || 'b6898194425_u575596036',
    };
  }

  /**
   * Get default nutrition goals
   * @returns {Object}
   */
  getNutritionGoals() {
    // Check new structure first
    const defaultUser = this.#appConfig.chatbots?.users?.kckern;
    if (defaultUser?.goals) {
      return {
        calories: defaultUser.goals.calories || 2000,
        protein: defaultUser.goals.protein || 150,
        carbs: defaultUser.goals.carbs || 200,
        fat: defaultUser.goals.fat || 65,
      };
    }
    
    // Legacy fallback
    const nutribot = this.#appConfig.nutribot || {};
    return {
      calories: nutribot.goals?.calories || 2000,
      protein: nutribot.goals?.protein || 150,
      carbs: nutribot.goals?.carbs || 200,
      fat: nutribot.goals?.fat || 65,
    };
  }

  /**
   * Get NutriBot data path
   * @param {string} type - 'nutrilog' or 'nutrilist'
   * @returns {string}
   */
  getNutribotDataPath(type) {
    const config = this.getNutribotConfig();
    const basePath = this.#env.DATA_PATH || this.#appConfig.path?.data || '/data';
    
    switch (type) {
      case 'nutrilog':
        return path.join(basePath, config.data.nutrilogPath);
      case 'nutrilist':
        return path.join(basePath, config.data.nutrilistPath);
      default:
        return basePath;
    }
  }

  // ==================== Journalist Config ====================

  /**
   * Get Journalist configuration
   * @returns {Object}
   */
  getJournalistConfig() {
    const bot = this.getBotConfig('journalist');
    const chatbots = this.#appConfig.chatbots || {};
    const data = chatbots.data?.journalist || {};
    
    // Legacy fallback
    const legacyJournalist = this.#appConfig.journalist || {};
    
    return {
      telegram: {
        botId: bot.telegramBotId,
        token: bot.token,
        webhookUrl: bot.webhookUrl,
      },
      users: {
        defaultUserId: String(legacyJournalist.journalist_user_id || '575596036'),
      },
      data: {
        entriesPath: data.entries || 'lifelog/journalist/entries',
      },
      mysql: {
        database: chatbots.mysql?.database || legacyJournalist.mysql_db || 'journalist',
      },
    };
  }

  // ==================== Telegram Config ====================

  /**
   * Get Telegram bot token
   * @param {string} botName - 'nutribot' or 'journalist'
   * @returns {string|null}
   */
  getTelegramToken(botName) {
    const tokenKey = `TELEGRAM_${botName.toUpperCase()}_TOKEN`;
    
    // Priority: environment variable > secrets file
    return this.#env[tokenKey] || this.#secrets[tokenKey] || null;
  }

  /**
   * Get Telegram bot ID
   * @param {string} botName - 'nutribot' or 'journalist'
   * @returns {string}
   */
  getTelegramBotId(botName) {
    // Use new structure first
    const bot = this.#appConfig.chatbots?.bots?.[botName];
    if (bot?.telegram_bot_id) {
      return String(bot.telegram_bot_id);
    }
    
    // Legacy fallback
    return String(this.#getLegacyBotId(botName));
  }

  /**
   * Get Telegram webhook URL for a bot
   * @param {string} botName - 'nutribot' or 'journalist'
   * @returns {string}
   */
  getTelegramWebhookUrl(botName) {
    const config = botName === 'nutribot' 
      ? this.getNutribotConfig() 
      : this.getJournalistConfig();
    return config.telegram.webhookUrl;
  }

  // ==================== API Keys ====================

  /**
   * Get OpenAI API key
   * @returns {string|null}
   */
  getOpenAIKey() {
    return this.#env.OPENAI_API_KEY || this.#secrets.OPENAI_API_KEY || null;
  }

  /**
   * Get Nutritionix credentials
   * @returns {{ appId: string, apiKey: string }}
   */
  getNutritionixCredentials() {
    return {
      appId: this.#appConfig.nutritionix_app_id || this.#secrets.NUTRITIONIX_APP_ID || '',
      apiKey: this.#secrets.NUTRITIONIX_API_KEY || '',
    };
  }

  /**
   * Get Edamam credentials
   * @returns {{ appId: string, appKey: string }}
   */
  getEdamamCredentials() {
    return {
      appId: this.#secrets.ED_APP_ID || '',
      appKey: this.#secrets.ED_APP_KEY || '',
    };
  }

  /**
   * Get UPCitemDB API key
   * @returns {string}
   */
  getUPCiteKey() {
    return this.#secrets.UPCITE || '';
  }

  // ==================== Database Config ====================

  /**
   * Get MySQL configuration
   * @returns {Object}
   */
  getMySQLConfig() {
    return {
      host: this.#secrets.MYSQL_HOST || 'localhost',
      port: parseInt(this.#secrets.MYSQL_PORT || '3306', 10),
      user: this.#secrets.MYSQL_USER || 'root',
      password: this.#secrets.MYSQL_PASS || '',
      database: this.#appConfig.journalist?.mysql_db || 'journalist',
    };
  }

  // ==================== Utility Methods ====================

  /**
   * Get raw app config (for backwards compatibility)
   * @returns {Object}
   */
  getRawAppConfig() {
    return this.#appConfig;
  }

  /**
   * Get a specific value from app config by path
   * @param {string} path - Dot-separated path (e.g., 'journalist.mysql_db')
   * @param {*} [defaultValue] - Default value if not found
   * @returns {*}
   */
  get(path, defaultValue = undefined) {
    const parts = path.split('.');
    let value = this.#appConfig;
    
    for (const part of parts) {
      if (value === undefined || value === null) return defaultValue;
      value = value[part];
    }
    
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get a secret value
   * @param {string} key - Secret key name
   * @param {*} [defaultValue] - Default value if not found
   * @returns {*}
   */
  getSecret(key, defaultValue = undefined) {
    return this.#env[key] || this.#secrets[key] || defaultValue;
  }
}

// ==================== Singleton Instance ====================

let instance = null;

/**
 * Get the singleton ConfigProvider instance
 * @param {Object} [options] - Options to pass to constructor (only used on first call)
 * @returns {ConfigProvider}
 */
export function getConfigProvider(options = {}) {
  if (!instance) {
    instance = new ConfigProvider(options);
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetConfigProvider() {
  instance = null;
}

export default ConfigProvider;
