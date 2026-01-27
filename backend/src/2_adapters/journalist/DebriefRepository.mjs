/**
 * Debrief Repository
 * @module journalist/adapters/DebriefRepository
 *
 * Handles persistence of morning debrief data to debriefs.yml
 */

import path from 'path';
import {
  ensureDir,
  loadYamlFromPath,
  saveYamlToPath,
  resolveYamlPath
} from '#system/utils/FileIO.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

/**
 * Repository for persisting debrief data
 */
export class DebriefRepository {
  #logger;
  #dataPath;

  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logger instance
   * @param {string} deps.dataPath - Path to user's journalist data directory
   */
  constructor(deps) {
    this.#logger = deps.logger;
    this.#dataPath = deps.dataPath;
  }

  /**
   * Append a debrief to the debriefs.yml file
   *
   * @param {Object} debrief - Debrief data to append
   * @param {string} debrief.date - Date of the debrief (YYYY-MM-DD)
   * @param {string} debrief.summary - Generated summary text
   * @param {Array} debrief.summaries - Source summaries with category/source info
   * @param {string} debrief.timestamp - When debrief was generated (ISO format)
   * @returns {Promise<void>}
   */
  async appendDebrief(debrief) {
    const debriefPath = path.join(this.#dataPath, 'debriefs.yml');

    try {
      // Read existing debriefs or initialize empty structure
      let debriefs = { debriefs: [] };

      const basePath = debriefPath.replace(/\.yml$/, '');
      const resolvedPath = resolveYamlPath(basePath);
      if (resolvedPath) {
        debriefs = loadYamlFromPath(resolvedPath) || { debriefs: [] };
      }

      // Ensure debriefs array exists
      if (!debriefs.debriefs) {
        debriefs.debriefs = [];
      }

      // Build debrief entry
      const entry = {
        date: debrief.date,
        timestamp: debrief.timestamp || nowTs24(),
        summary: debrief.summary,
        summaries: debrief.summaries || [],
      };

      // Append to beginning (newest first)
      debriefs.debriefs.unshift(entry);

      // Write back to file
      ensureDir(path.dirname(debriefPath));
      saveYamlToPath(debriefPath, debriefs, {
        quotingType: '"',
        forceQuotes: true,
      });

      this.#logger?.info('debrief.persisted', {
        date: debrief.date,
        path: debriefPath,
        totalDebriefs: debriefs.debriefs.length,
      });
    } catch (error) {
      this.#logger?.error('debrief.persist-failed', {
        date: debrief.date,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get all debriefs (newest first)
   * @returns {Promise<Array>} Array of debrief entries
   */
  async getAllDebriefs() {
    const debriefPath = path.join(this.#dataPath, 'debriefs.yml');

    try {
      const basePath = debriefPath.replace(/\.yml$/, '');
      const resolvedPath = resolveYamlPath(basePath);
      if (!resolvedPath) {
        return [];
      }

      const data = loadYamlFromPath(resolvedPath);
      return data?.debriefs || [];
    } catch (error) {
      this.#logger?.error('debrief.read-failed', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get the most recent debriefs
   * @param {string} username - Username (optional, for logging)
   * @param {number} limit - Maximum number of debriefs to return
   * @returns {Promise<Array>} Array of recent debrief entries
   */
  async getRecentDebriefs(username, limit = 5) {
    const debriefs = await this.getAllDebriefs();
    return debriefs.slice(0, limit);
  }

  /**
   * Get debrief for a specific date
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<Object|null>} Debrief entry or null
   */
  async getDebriefByDate(date) {
    const debriefs = await this.getAllDebriefs();
    return debriefs.find((d) => d.date === date) || null;
  }
}

export default DebriefRepository;
