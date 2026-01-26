/**
 * Archive Service - Hot/Cold Storage Management
 *
 * Migrated from: backend/_legacy/lib/ArchiveService.mjs
 *
 * Manages splitting of large lifelog files into:
 * - HOT storage: Recent data (configurable retention, default 90 days) in lifelog/{service}.yml
 * - COLD storage: Historical data in archives/{service}/{year}.yml
 *
 * Key features:
 * - Config-driven: Services opt-in via config/apps/archive.yml
 * - Mode-aware writes: Incremental -> hot, Backfill -> cold (direct)
 * - Fast entropy path: getMostRecentTimestamp() reads only first entry
 * - Date-range queries: Merges hot + relevant cold archives
 * - Write queue integration: Uses io.mjs queues for safe concurrent writes
 *
 * Data formats supported:
 * - 'array': Sorted array with timestampField (e.g., lastfm scrobbles)
 * - 'dateKeyed': Object keyed by YYYY-MM-DD (e.g., garmin daily data)
 */

import moment from 'moment-timezone';
import fs from 'fs';
import yaml from 'js-yaml';
import { userDataService } from '../../../0_infrastructure/config/index.mjs';
import { createLogger } from '../../../0_infrastructure/logging/logger.js';
import { configService } from '../../../0_infrastructure/config/index.mjs';

const archiveLogger = createLogger({
  source: 'backend',
  app: 'archive'
});

/**
 * Adapter: Load user lifelog file (wraps UserDataService)
 * @param {string} username
 * @param {string} service - e.g., 'fitness' or 'archives/lastfm/2024'
 * @returns {object|null}
 */
const userLoadFile = (username, service) => {
  return userDataService.readUserData(username, `lifelog/${service}`);
};

/**
 * Adapter: Save user lifelog file (wraps UserDataService)
 * @param {string} username
 * @param {string} service
 * @param {object} data
 * @returns {boolean}
 */
const userSaveFile = (username, service, data) => {
  return userDataService.writeUserData(username, `lifelog/${service}`, data);
};

// Cache config to avoid repeated file reads
let archiveConfig = null;

/**
 * Load archive configuration from config/archive.yml (system-level config)
 * @returns {Object} Archive configuration
 */
const loadConfig = () => {
  if (archiveConfig) return archiveConfig;

  try {
    // Archive is system-level config - look in config directory from ConfigService
    const configDir = configService.getConfigDir();
    if (!configDir) {
      archiveLogger.warn('archive.config.noConfigDir', {
        message: 'ConfigService.getConfigDir() returned null - archive features disabled'
      });
      archiveConfig = { services: {}, defaults: {} };
      return archiveConfig;
    }

    const configPath = `${configDir}/archive.yml`;
    if (fs.existsSync(configPath)) {
      const fileData = fs.readFileSync(configPath, 'utf8');
      archiveConfig = yaml.load(fileData) || { services: {}, defaults: {} };
    } else {
      archiveLogger.warn('archive.config.notFound', { configPath });
      archiveConfig = { services: {}, defaults: {} };
    }
  } catch (e) {
    archiveLogger.warn('archive.config.loadFailed', { error: e.message });
    archiveConfig = { services: {}, defaults: {} };
  }
  return archiveConfig;
};

/**
 * Get configuration for a specific service
 * @param {string} service - Service name (e.g., 'lastfm')
 * @returns {Object|null} Service config or null if not archive-enabled
 */
export const getConfig = (service) => {
  const config = loadConfig();
  const serviceConfig = config.services?.[service];

  if (!serviceConfig || !serviceConfig.enabled) {
    return null;
  }

  // Merge with defaults
  return {
    ...config.defaults,
    ...serviceConfig
  };
};

/**
 * Check if a service uses archive storage
 * @param {string} service - Service name
 * @returns {boolean} True if service is archive-enabled
 */
export const isArchiveEnabled = (service) => {
  return getConfig(service) !== null;
};

/**
 * Get hot data only (recent entries within retention window)
 * @param {string} username - The username
 * @param {string} service - Service name
 * @returns {Array|Object|null} Hot data
 */
export const getHotData = (username, service) => {
  return userLoadFile(username, service);
};

/**
 * Get the most recent timestamp from hot storage (fast path for entropy)
 * Only reads the hot file and extracts the first/most recent entry
 * @param {string} username - The username
 * @param {string} service - Service name
 * @returns {Object|null} { timestamp: number, date: string } or null
 */
export const getMostRecentTimestamp = (username, service) => {
  const config = getConfig(service);
  const data = getHotData(username, service);

  if (!data) return null;

  if (config?.dataFormat === 'dateKeyed') {
    // Object keyed by date - find most recent key
    const dates = Object.keys(data).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dates.length === 0) return null;

    dates.sort((a, b) => moment(b).diff(moment(a)));
    const mostRecentDate = dates[0];

    return {
      timestamp: moment(mostRecentDate).unix(),
      date: mostRecentDate,
      data: data[mostRecentDate]
    };
  } else {
    // Array format - first entry is most recent (sorted newest-first)
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0];
    const timestampField = config?.timestampField || 'timestamp';
    const dateField = config?.dateField || 'date';

    return {
      timestamp: first[timestampField] || moment(first[dateField]).unix(),
      date: first[dateField] || moment.unix(first[timestampField]).format('YYYY-MM-DD'),
      data: first
    };
  }
};

/**
 * Save data to hot storage
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {Array|Object} data - Data to save
 * @returns {boolean} Success
 */
export const saveToHot = (username, service, data) => {
  return userSaveFile(username, service, data);
};

/**
 * Load a specific yearly archive
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {number|string} year - Year (e.g., 2024)
 * @returns {Object|null} Archive data (date-keyed)
 */
export const loadArchive = (username, service, year) => {
  return userLoadFile(username, `archives/${service}/${year}`);
};

/**
 * Save data directly to a yearly archive
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {number|string} year - Year
 * @param {Object} data - Date-keyed archive data
 * @returns {boolean} Success
 */
export const saveToArchive = (username, service, year, data) => {
  archiveLogger.info('archive.saveToArchive', {
    username,
    service,
    year,
    dateCount: Object.keys(data).length
  });
  return userSaveFile(username, `archives/${service}/${year}`, data);
};

/**
 * Append entries directly to archives (partitioned by year)
 * Used by backfill mode to write historical data directly to cold storage
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {Array} entries - Array of entries to archive
 * @returns {Object} Stats: { entriesProcessed, yearsUpdated }
 */
export const appendToArchive = (username, service, entries) => {
  const config = getConfig(service);
  if (!config) {
    archiveLogger.warn('archive.appendToArchive.notEnabled', { service });
    return { entriesProcessed: 0, yearsUpdated: [] };
  }

  const timestampField = config.timestampField || 'timestamp';
  const dateField = config.dateField || 'date';
  const idField = config.idField || 'id';

  // Partition entries by year
  const byYear = {};

  for (const entry of entries) {
    let entryDate;
    if (entry[timestampField]) {
      entryDate = moment.unix(entry[timestampField]);
    } else if (entry[dateField]) {
      entryDate = moment(entry[dateField]);
    } else {
      continue; // Skip entries without date
    }

    const year = entryDate.year();
    const dateKey = entryDate.format('YYYY-MM-DD');

    if (!byYear[year]) {
      byYear[year] = {};
    }
    if (!byYear[year][dateKey]) {
      byYear[year][dateKey] = [];
    }
    byYear[year][dateKey].push(entry);
  }

  // Load existing archives, merge, and save
  const yearsUpdated = [];

  for (const [year, dateData] of Object.entries(byYear)) {
    const existing = loadArchive(username, service, year) || {};

    // Merge by date, dedupe by ID within each date
    for (const [dateKey, newEntries] of Object.entries(dateData)) {
      const existingDay = existing[dateKey] || [];
      const existingIds = new Set(existingDay.map(e => e[idField]));

      // Add only new entries
      for (const entry of newEntries) {
        if (!existingIds.has(entry[idField])) {
          existingDay.push(entry);
          existingIds.add(entry[idField]);
        }
      }

      // Sort by timestamp within day (newest first)
      existingDay.sort((a, b) => (b[timestampField] || 0) - (a[timestampField] || 0));
      existing[dateKey] = existingDay;
    }

    saveToArchive(username, service, year, existing);
    yearsUpdated.push(parseInt(year));
  }

  archiveLogger.info('archive.appendToArchive.complete', {
    username,
    service,
    entriesProcessed: entries.length,
    yearsUpdated
  });

  return { entriesProcessed: entries.length, yearsUpdated };
};

/**
 * Filter data to a specific date range
 */
const filterDataToRange = (data, startDate, endDate, config) => {
  if (!data) return config?.dataFormat === 'dateKeyed' ? {} : [];

  const start = moment(startDate);
  const end = moment(endDate);

  if (config?.dataFormat === 'dateKeyed') {
    const filtered = {};
    for (const [dateKey, value] of Object.entries(data)) {
      const d = moment(dateKey);
      if (d.isSameOrAfter(start, 'day') && d.isSameOrBefore(end, 'day')) {
        filtered[dateKey] = value;
      }
    }
    return filtered;
  } else if (Array.isArray(data)) {
    const timestampField = config?.timestampField || 'timestamp';
    const dateField = config?.dateField || 'date';

    return data.filter(entry => {
      let entryDate;
      if (entry[timestampField]) {
        entryDate = moment.unix(entry[timestampField]);
      } else if (entry[dateField]) {
        entryDate = moment(entry[dateField]);
      } else {
        return false;
      }
      return entryDate.isSameOrAfter(start, 'day') && entryDate.isSameOrBefore(end, 'day');
    });
  }

  return data;
};

/**
 * Get data for a specific date range, optionally including archives
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {Object} options - { includeArchive: boolean }
 * @returns {Array|Object} Merged data
 */
export const getDataForDateRange = (username, service, startDate, endDate, options = {}) => {
  const { includeArchive = false } = options;
  const config = getConfig(service);

  // Load hot data
  const hotData = getHotData(username, service);

  if (!includeArchive || !config) {
    // Just filter hot data to range
    return filterDataToRange(hotData, startDate, endDate, config);
  }

  // Determine which years we need
  const startYear = moment(startDate).year();
  const endYear = moment(endDate).year();
  const years = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  // Load and merge archives
  let mergedData = config?.dataFormat === 'dateKeyed' ? {} : [];

  for (const year of years) {
    const archive = loadArchive(username, service, year);
    if (archive) {
      if (config?.dataFormat === 'dateKeyed') {
        Object.assign(mergedData, archive);
      } else {
        // Archive is date-keyed, flatten to array
        for (const [date, entries] of Object.entries(archive)) {
          if (Array.isArray(entries)) {
            mergedData.push(...entries);
          }
        }
      }
    }
  }

  // Merge hot data
  if (hotData) {
    if (config?.dataFormat === 'dateKeyed') {
      Object.assign(mergedData, hotData);
    } else if (Array.isArray(hotData)) {
      mergedData.push(...hotData);
    }
  }

  // Dedupe and sort if array
  if (Array.isArray(mergedData)) {
    const idField = config?.idField || 'id';
    const timestampField = config?.timestampField || 'timestamp';
    const seen = new Map();

    for (const entry of mergedData) {
      seen.set(entry[idField], entry);
    }

    mergedData = Array.from(seen.values())
      .sort((a, b) => (b[timestampField] || 0) - (a[timestampField] || 0));
  }

  return filterDataToRange(mergedData, startDate, endDate, config);
};

/**
 * Rotate old entries from hot storage to yearly archives
 * Called by daily cron job
 * @param {string} username - The username
 * @param {string} service - Service name
 * @returns {Object} Stats: { rotated, kept, yearsUpdated }
 */
export const rotateToArchive = (username, service) => {
  const config = getConfig(service);
  if (!config) {
    archiveLogger.debug('archive.rotate.notEnabled', { service });
    return { rotated: 0, kept: 0, yearsUpdated: [] };
  }

  const retentionDays = config.retentionDays || 90;
  const cutoffDate = moment().subtract(retentionDays, 'days').format('YYYY-MM-DD');
  const cutoffMoment = moment(cutoffDate);

  const hotData = getHotData(username, service);
  if (!hotData) {
    return { rotated: 0, kept: 0, yearsUpdated: [] };
  }

  const timestampField = config.timestampField || 'timestamp';
  const dateField = config.dateField || 'date';

  if (config.dataFormat === 'dateKeyed') {
    // Object format: partition by date key
    const toKeep = {};
    const toArchive = {};

    for (const [dateKey, value] of Object.entries(hotData)) {
      if (!(/^\d{4}-\d{2}-\d{2}$/.test(dateKey))) {
        toKeep[dateKey] = value; // Keep non-date keys
        continue;
      }

      if (moment(dateKey).isBefore(cutoffMoment)) {
        const year = dateKey.substring(0, 4);
        if (!toArchive[year]) toArchive[year] = {};
        toArchive[year][dateKey] = value;
      } else {
        toKeep[dateKey] = value;
      }
    }

    // Save archives
    const yearsUpdated = [];
    for (const [year, data] of Object.entries(toArchive)) {
      const existing = loadArchive(username, service, year) || {};
      Object.assign(existing, data);
      saveToArchive(username, service, year, existing);
      yearsUpdated.push(parseInt(year));
    }

    // Save trimmed hot data
    saveToHot(username, service, toKeep);

    const rotatedCount = Object.keys(hotData).length - Object.keys(toKeep).length;
    archiveLogger.info('archive.rotate.complete', {
      username,
      service,
      rotated: rotatedCount,
      kept: Object.keys(toKeep).length,
      yearsUpdated
    });

    return { rotated: rotatedCount, kept: Object.keys(toKeep).length, yearsUpdated };

  } else {
    // Array format: partition by entry timestamp
    const toKeep = [];
    const toArchiveEntries = [];

    for (const entry of hotData) {
      let entryDate;
      if (entry[timestampField]) {
        entryDate = moment.unix(entry[timestampField]);
      } else if (entry[dateField]) {
        entryDate = moment(entry[dateField]);
      } else {
        toKeep.push(entry);
        continue;
      }

      if (entryDate.isBefore(cutoffMoment)) {
        toArchiveEntries.push(entry);
      } else {
        toKeep.push(entry);
      }
    }

    // Append old entries to archives
    let yearsUpdated = [];
    if (toArchiveEntries.length > 0) {
      const result = appendToArchive(username, service, toArchiveEntries);
      yearsUpdated = result.yearsUpdated;
    }

    // Save trimmed hot data
    saveToHot(username, service, toKeep);

    archiveLogger.info('archive.rotate.complete', {
      username,
      service,
      rotated: toArchiveEntries.length,
      kept: toKeep.length,
      yearsUpdated
    });

    return { rotated: toArchiveEntries.length, kept: toKeep.length, yearsUpdated };
  }
};

/**
 * One-time migration: Split existing monolithic file into hot + cold archives
 * @param {string} username - The username
 * @param {string} service - Service name
 * @param {Object} options - { dryRun: boolean }
 * @returns {Object} Migration stats
 */
export const migrateToHotCold = (username, service, options = {}) => {
  const { dryRun = true } = options;
  const config = getConfig(service);

  if (!config) {
    archiveLogger.warn('archive.migrate.notEnabled', { service });
    return { success: false, error: 'Service not enabled in archive.yml' };
  }

  const retentionDays = config.retentionDays || 90;
  const cutoffDate = moment().subtract(retentionDays, 'days').format('YYYY-MM-DD');
  const cutoffMoment = moment(cutoffDate);

  // Load current monolithic file
  const allData = userLoadFile(username, service);
  if (!allData) {
    return { success: false, error: 'No existing data found' };
  }

  const timestampField = config.timestampField || 'timestamp';
  const dateField = config.dateField || 'date';

  let hotData, coldByYear;
  let originalCount, hotCount, coldCount;

  if (config.dataFormat === 'dateKeyed') {
    hotData = {};
    coldByYear = {};
    originalCount = Object.keys(allData).length;

    for (const [dateKey, value] of Object.entries(allData)) {
      if (!(/^\d{4}-\d{2}-\d{2}$/.test(dateKey))) {
        hotData[dateKey] = value;
        continue;
      }

      if (moment(dateKey).isBefore(cutoffMoment)) {
        const year = dateKey.substring(0, 4);
        if (!coldByYear[year]) coldByYear[year] = {};
        coldByYear[year][dateKey] = value;
      } else {
        hotData[dateKey] = value;
      }
    }

    hotCount = Object.keys(hotData).length;
    coldCount = originalCount - hotCount;

  } else {
    // Array format
    hotData = [];
    coldByYear = {};
    originalCount = Array.isArray(allData) ? allData.length : 0;

    if (!Array.isArray(allData)) {
      return { success: false, error: 'Expected array data format' };
    }

    for (const entry of allData) {
      let entryDate;
      if (entry[timestampField]) {
        entryDate = moment.unix(entry[timestampField]);
      } else if (entry[dateField]) {
        entryDate = moment(entry[dateField]);
      } else {
        hotData.push(entry);
        continue;
      }

      if (entryDate.isBefore(cutoffMoment)) {
        const year = entryDate.year();
        const dateKey = entryDate.format('YYYY-MM-DD');

        if (!coldByYear[year]) coldByYear[year] = {};
        if (!coldByYear[year][dateKey]) coldByYear[year][dateKey] = [];
        coldByYear[year][dateKey].push(entry);
      } else {
        hotData.push(entry);
      }
    }

    hotCount = hotData.length;
    coldCount = originalCount - hotCount;
  }

  // Calculate archive sizes
  const archiveStats = {};
  for (const [year, data] of Object.entries(coldByYear)) {
    const entryCount = config.dataFormat === 'dateKeyed'
      ? Object.keys(data).length
      : Object.values(data).flat().length;
    archiveStats[year] = { dates: Object.keys(data).length, entries: entryCount };
  }

  const stats = {
    success: true,
    dryRun,
    service,
    originalCount,
    hotCount,
    coldCount,
    cutoffDate,
    retentionDays,
    archives: archiveStats,
    yearsCreated: Object.keys(coldByYear).map(Number).sort()
  };

  if (dryRun) {
    archiveLogger.info('archive.migrate.dryRun', stats);
    return stats;
  }

  // Create backup
  const backupPath = `${service}.premigration`;
  userSaveFile(username, backupPath, allData);
  archiveLogger.info('archive.migrate.backup', { username, service, backupPath });

  // Save archives
  for (const [year, data] of Object.entries(coldByYear)) {
    saveToArchive(username, service, year, data);
  }

  // Save hot data
  saveToHot(username, service, hotData);

  archiveLogger.info('archive.migrate.complete', stats);
  return stats;
};

/**
 * List all archive years for a service
 * @param {string} username - The username
 * @param {string} service - Service name
 * @returns {Array<number>} Years with archives
 */
export const listArchiveYears = (username, service) => {
  const archivePath = `${process.env.path.data}/users/${username}/lifelog/archives/${service}`;

  if (!fs.existsSync(archivePath)) {
    return [];
  }

  const files = fs.readdirSync(archivePath);
  return files
    .filter(f => /^\d{4}\.yml$/.test(f))
    .map(f => parseInt(f.replace('.yml', '')))
    .sort((a, b) => b - a); // Newest first
};

/**
 * Get archive status for a service (for monitoring)
 * @param {string} username - The username
 * @param {string} service - Service name
 * @returns {Object} Status info
 */
export const getArchiveStatus = (username, service) => {
  const config = getConfig(service);
  const hotData = getHotData(username, service);
  const years = listArchiveYears(username, service);

  let hotCount = 0;
  if (hotData) {
    hotCount = config?.dataFormat === 'dateKeyed'
      ? Object.keys(hotData).length
      : (Array.isArray(hotData) ? hotData.length : 0);
  }

  const archiveStats = {};
  for (const year of years) {
    const archive = loadArchive(username, service, year);
    if (archive) {
      const dates = Object.keys(archive).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
      archiveStats[year] = {
        dates: dates.length,
        entries: config?.dataFormat === 'dateKeyed'
          ? dates.length
          : dates.reduce((sum, d) => sum + (Array.isArray(archive[d]) ? archive[d].length : 0), 0)
      };
    }
  }

  return {
    service,
    enabled: !!config,
    config: config ? {
      retentionDays: config.retentionDays,
      archiveGranularity: config.archiveGranularity,
      dataFormat: config.dataFormat
    } : null,
    hot: {
      count: hotCount
    },
    archives: archiveStats,
    years
  };
};

// Clear config cache (useful for tests)
export const clearConfigCache = () => {
  archiveConfig = null;
};

export default {
  getConfig,
  isArchiveEnabled,
  getHotData,
  getMostRecentTimestamp,
  saveToHot,
  loadArchive,
  saveToArchive,
  appendToArchive,
  getDataForDateRange,
  rotateToArchive,
  migrateToHotCold,
  listArchiveYears,
  getArchiveStatus,
  clearConfigCache
};
