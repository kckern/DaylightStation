/**
 * Prompt Loader
 * @module _lib/prompts/PromptLoader
 * 
 * Loads prompt definitions from YAML files with caching.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { createLogger } from '../logging/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger({ source: 'prompts', app: 'loader' });

/**
 * Prompt Loader
 * 
 * Loads prompts from YAML files with fallback hierarchy:
 * 1. User-specific: /data/users/{username}/ai/{bot}/prompts.yaml
 * 2. Bot defaults: /data/defaults/ai/{bot}/prompts.yaml
 * 3. Hardcoded: ./defaultPrompts/{bot}.yaml
 */
export class PromptLoader {
  #dataPath;
  #cache;
  #cacheTTL;
  #cacheTimestamps;

  /**
   * @param {Object} config
   * @param {string} config.dataPath - Base data directory path
   * @param {number} [config.cacheTTL=60000] - Cache TTL in milliseconds (default: 1 minute)
   */
  constructor(config = {}) {
    this.#dataPath = config.dataPath || process.env.DATA_PATH || '/data';
    this.#cacheTTL = config.cacheTTL ?? 60000;
    this.#cache = new Map();
    this.#cacheTimestamps = new Map();
  }

  /**
   * Load prompts for a bot, with fallback hierarchy
   * @param {string} bot - Bot name (nutribot, journalist)
   * @param {string} [username] - Optional username for user-specific prompts
   * @returns {Promise<Object>} Merged prompt definitions
   */
  async loadPrompts(bot, username = null) {
    const cacheKey = `${bot}:${username || 'default'}`;
    
    // Check cache
    if (this.#isCacheValid(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    // Load from hierarchy (later sources override earlier)
    const prompts = {};

    // 1. Hardcoded defaults (lowest priority)
    const hardcodedPath = join(__dirname, 'defaultPrompts', `${bot}.yaml`);
    const hardcoded = await this.#loadYamlFile(hardcodedPath);
    if (hardcoded?.prompts) {
      Object.assign(prompts, hardcoded.prompts);
    }

    // 2. Data directory defaults
    const defaultsPath = join(this.#dataPath, 'defaults', 'ai', bot, 'prompts.yaml');
    const defaults = await this.#loadYamlFile(defaultsPath);
    if (defaults?.prompts) {
      this.#mergePrompts(prompts, defaults.prompts);
    }

    // 3. User-specific overrides (highest priority)
    if (username) {
      const userPath = join(this.#dataPath, 'users', username, 'ai', bot, 'prompts.yaml');
      const userPrompts = await this.#loadYamlFile(userPath);
      if (userPrompts?.prompts) {
        this.#mergePrompts(prompts, userPrompts.prompts);
      }
    }

    // Cache the result
    this.#cache.set(cacheKey, prompts);
    this.#cacheTimestamps.set(cacheKey, Date.now());

    logger.debug('prompts.loaded', { 
      bot, 
      username, 
      promptCount: Object.keys(prompts).length,
    });

    return prompts;
  }

  /**
   * Load a specific prompt by ID
   * @param {string} bot - Bot name
   * @param {string} promptId - Prompt identifier
   * @param {string} [username] - Optional username
   * @returns {Promise<Object|null>} Prompt definition or null
   */
  async loadPrompt(bot, promptId, username = null) {
    const prompts = await this.loadPrompts(bot, username);
    return prompts[promptId] || null;
  }

  /**
   * List available prompt IDs for a bot
   * @param {string} bot - Bot name
   * @param {string} [username] - Optional username
   * @returns {Promise<string[]>}
   */
  async listPromptIds(bot, username = null) {
    const prompts = await this.loadPrompts(bot, username);
    return Object.keys(prompts);
  }

  /**
   * Clear cache (or specific entry)
   * @param {string} [bot] - Optional bot to clear
   * @param {string} [username] - Optional username to clear
   */
  clearCache(bot = null, username = null) {
    if (bot) {
      const cacheKey = `${bot}:${username || 'default'}`;
      this.#cache.delete(cacheKey);
      this.#cacheTimestamps.delete(cacheKey);
    } else {
      this.#cache.clear();
      this.#cacheTimestamps.clear();
    }
    logger.debug('prompts.cache.cleared', { bot, username });
  }

  /**
   * Check if cache entry is still valid
   * @private
   */
  #isCacheValid(cacheKey) {
    if (!this.#cache.has(cacheKey)) return false;
    
    const timestamp = this.#cacheTimestamps.get(cacheKey);
    if (!timestamp) return false;
    
    return (Date.now() - timestamp) < this.#cacheTTL;
  }

  /**
   * Load and parse a YAML file
   * @private
   */
  async #loadYamlFile(filePath) {
    try {
      if (!existsSync(filePath)) {
        return null;
      }

      const content = await readFile(filePath, 'utf-8');
      return yaml.load(content);
    } catch (error) {
      logger.warn('prompts.load.error', { filePath, error: error.message });
      return null;
    }
  }

  /**
   * Deep merge prompts (source overrides target)
   * @private
   */
  #mergePrompts(target, source) {
    for (const [promptId, promptDef] of Object.entries(source)) {
      if (target[promptId]) {
        // Merge prompt definition (messages, config, etc.)
        target[promptId] = {
          ...target[promptId],
          ...promptDef,
          // Deep merge messages array if both exist
          messages: promptDef.messages || target[promptId].messages,
        };
      } else {
        target[promptId] = promptDef;
      }
    }
  }

  /**
   * Get data path for a bot/user combination
   * @param {string} bot
   * @param {string} [username]
   * @returns {string}
   */
  getPromptPath(bot, username = null) {
    if (username) {
      return join(this.#dataPath, 'users', username, 'ai', bot, 'prompts.yaml');
    }
    return join(this.#dataPath, 'defaults', 'ai', bot, 'prompts.yaml');
  }
}

export default PromptLoader;
