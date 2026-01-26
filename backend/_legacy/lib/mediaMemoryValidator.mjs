/**
 * DEPRECATED: Legacy Media Memory Validator Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs
 *
 * Note: The new version uses a class-based API. This shim provides a
 * compatibility wrapper that matches the original function signature.
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/mediaMemoryValidator.mjs is deprecated.\n' +
  'Update imports to: #backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
);

import path from 'path';
import fs from 'fs';
import moment from 'moment-timezone';
import { stringify as stringifyYaml } from 'yaml';
import { createLogger } from './logging/logger.js';
import { configService } from './config/index.mjs';
import { MediaMemoryValidatorService } from '../../src/1_domains/content/services/MediaMemoryValidatorService.mjs';
import { getMediaMemoryDir, getMediaMemoryFiles } from '../../src/3_applications/content/services/MediaMemoryService.mjs';

const logger = createLogger({ source: 'cron', app: 'mediaMemoryValidator' });

/**
 * Legacy PlexClient wrapper for the new service
 * Creates a PlexClient-like interface from configService
 */
class LegacyPlexClient {
  constructor() {
    const auth = configService.getHouseholdAuth('plex') || {};
    this.token = auth.token;
    const { plex: plexEnv } = process.env;
    this.host = auth.server_url?.replace(/:\d+$/, '') || plexEnv?.host;
    this.port = plexEnv?.port;
    this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
  }

  async fetch(endpoint) {
    const axios = (await import('./http.mjs')).default;
    const url = `${this.baseUrl}/${endpoint}`;
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}X-Plex-Token=${this.token}`;
    try {
      const response = await axios.get(fullUrl, { headers: { Accept: 'application/json' } });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }

  async checkConnectivity() {
    try {
      const data = await this.fetch('identity');
      return !!data?.MediaContainer?.machineIdentifier;
    } catch {
      return false;
    }
  }

  async verifyId(plexId) {
    const data = await this.fetch(`library/metadata/${plexId}`);
    return data?.MediaContainer?.Metadata?.[0] || null;
  }

  async hubSearch(query, libraryId = null) {
    const sectionParam = libraryId ? `&sectionId=${libraryId}` : '';
    const data = await this.fetch(`hubs/search?query=${encodeURIComponent(query)}${sectionParam}`);
    const hubs = data?.MediaContainer?.Hub || [];
    const results = [];
    for (const hub of hubs) {
      for (const item of (hub.Metadata || [])) {
        results.push({
          id: item.ratingKey,
          title: item.title,
          parent: item.parentTitle,
          grandparent: item.grandparentTitle,
          type: item.type
        });
      }
    }
    return results;
  }
}

/**
 * Legacy WatchStateStore wrapper
 * Adapts file-based storage to the service's expected interface
 */
class LegacyWatchStateStore {
  constructor() {
    this.files = getMediaMemoryFiles();
    this.dataByFile = new Map();
    this.yaml = null;
  }

  async loadYaml() {
    if (!this.yaml) {
      this.yaml = await import('yaml');
    }
    return this.yaml;
  }

  async getAllEntries() {
    const { parse: parseYaml } = await this.loadYaml();
    const entries = [];

    for (const fileInfo of this.files) {
      const content = fs.readFileSync(fileInfo.path, 'utf8');
      const data = parseYaml(content) || {};
      this.dataByFile.set(fileInfo.path, { data, fileInfo });

      for (const [plexId, entry] of Object.entries(data)) {
        entries.push({
          id: plexId,
          ...entry,
          libraryId: fileInfo.libraryId,
          _filePath: fileInfo.path
        });
      }
    }

    return entries;
  }

  async updateId(oldId, newId, updates) {
    // Find which file contains this entry
    for (const [filePath, { data, fileInfo }] of this.dataByFile.entries()) {
      if (data[oldId]) {
        const entry = data[oldId];
        delete data[oldId];
        data[newId] = { ...entry, ...updates };

        // Write back to file
        const yaml = stringifyYaml(data, { lineWidth: 0 });
        fs.writeFileSync(filePath, yaml, 'utf8');
        break;
      }
    }
  }
}

/**
 * Legacy compatibility wrapper for validateMediaMemory
 * Maintains the original function signature while using the new service
 */
export default async function validateMediaMemory(guidId) {
  logger.info('mediaMemory.validator.started', { guidId });

  const plexClient = new LegacyPlexClient();
  const watchStateStore = new LegacyWatchStateStore();

  const service = new MediaMemoryValidatorService({
    plexClient,
    watchStateStore,
    logger
  });

  const result = await service.validateMediaMemory();

  // Write work log if changes or unresolved (matching legacy behavior)
  if (result.changes?.length > 0 || result.unresolvedList?.length > 0) {
    const logsDir = path.join(getMediaMemoryDir(), 'plex', '_logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, `${moment().format('YYYY-MM-DD')}.yml`);
    const logData = {
      date: moment().format('YYYY-MM-DD'),
      runTime: new Date().toISOString(),
      summary: {
        checked: result.checked,
        valid: result.valid,
        backfilled: result.backfilled,
        unresolved: result.unresolved
      },
      ...(result.changes?.length > 0 && { changes: result.changes }),
      ...(result.unresolvedList?.length > 0 && { unresolved: result.unresolvedList })
    };

    fs.writeFileSync(logFile, stringifyYaml(logData, { lineWidth: 0 }), 'utf8');
    logger.info('mediaMemory.validator.logWritten', { path: logFile });
  }

  return result;
}

// Also export the service class for direct usage
export { MediaMemoryValidatorService } from '../../src/1_domains/content/services/MediaMemoryValidatorService.mjs';
