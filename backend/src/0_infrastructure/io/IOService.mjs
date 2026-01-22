/**
 * IOService - Content and State File Operations
 *
 * Provides YAML file operations for:
 * - Content files (read-only content like songs, quotes)
 * - State files (runtime state like watchlists, weather cache)
 * - Random content selection
 *
 * For user-namespaced data, use UserDataService instead.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { configService } from '../config/index.mjs';
import { createLogger } from '../logging/logger.js';

const logger = createLogger({
  source: 'backend',
  app: 'io-service'
});

// Custom YAML schema for flow sequences (arrays of numbers on one line)
class FlowSequence extends Array {}

const FlowSequenceType = new yaml.Type('tag:yaml.org,2002:seq', {
  kind: 'sequence',
  instanceOf: FlowSequence,
  represent: (sequence) => sequence,
  defaultStyle: 'flow'
});

const CUSTOM_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([FlowSequenceType]);

// Per-path write queues to avoid concurrent save collisions
const SAVE_QUEUES = globalThis.__daylightSaveQueues || new Map();
globalThis.__daylightSaveQueues = SAVE_QUEUES;

/**
 * Mark arrays of integers as flow sequences for compact YAML output
 */
const markFlowSequences = (value) => {
  if (Array.isArray(value)) {
    const processed = value.map((item) => markFlowSequences(item));
    const isAllIntegers = processed.length > 0 &&
      processed.every(v => v === null || (typeof v === 'number' && Number.isInteger(v)));
    if (isAllIntegers) {
      const flowSequence = new FlowSequence();
      processed.forEach((item) => flowSequence.push(item));
      return flowSequence;
    }
    return processed;
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      value[key] = markFlowSequences(value[key]);
    });
  }

  return value;
};

export class IOService {
  #dataDir = null;

  constructor() {
    // Lazy init from ConfigService
  }

  #ensureDataDir() {
    if (!this.#dataDir) {
      this.#dataDir = configService.getDataDir();
    }
    return this.#dataDir;
  }

  /**
   * Load a YAML file from the data directory
   * @param {string} relativePath - Path relative to data dir (without .yml extension)
   * @returns {object|null}
   */
  loadFile(relativePath) {
    const dataDir = this.#ensureDataDir();
    const cleanPath = relativePath.replace(/\.(ya?ml)$/, '');

    // Try both .yml and .yaml extensions
    for (const ext of ['.yml', '.yaml']) {
      const fullPath = path.join(dataDir, cleanPath + ext);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return yaml.load(content) || null;
        } catch (err) {
          logger.error('io.loadFile.parseError', { path: fullPath, error: err.message });
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Save data to a YAML file in the data directory
   * Uses write queue to prevent concurrent writes to same file
   * @param {string} relativePath - Path relative to data dir (without .yml extension)
   * @param {object} data - Data to save
   * @returns {Promise<boolean>}
   */
  async saveFile(relativePath, data) {
    const dataDir = this.#ensureDataDir();
    const cleanPath = relativePath.replace(/\.(ya?ml)$/, '');
    const fullPath = path.join(dataDir, cleanPath + '.yml');

    // Queue write to prevent concurrent saves
    const queue = SAVE_QUEUES.get(fullPath) || Promise.resolve();
    const writePromise = queue.then(async () => {
      try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const markedData = markFlowSequences(structuredClone(data));
        const content = yaml.dump(markedData, {
          schema: CUSTOM_YAML_SCHEMA,
          lineWidth: -1,
          quotingType: '"'
        });

        fs.writeFileSync(fullPath, content, 'utf8');
        return true;
      } catch (err) {
        logger.error('io.saveFile.error', { path: fullPath, error: err.message });
        return false;
      }
    });

    SAVE_QUEUES.set(fullPath, writePromise);
    return writePromise;
  }

  /**
   * Load a random YAML file from a folder
   * @param {string} folder - Folder path relative to data dir
   * @returns {object|null}
   */
  loadRandom(folder) {
    const dataDir = this.#ensureDataDir();
    const fullPath = path.join(dataDir, folder);

    if (!fs.existsSync(fullPath)) {
      logger.warn('io.loadRandom.folderMissing', { path: fullPath });
      return null;
    }

    const files = fs.readdirSync(fullPath).filter(file =>
      (file.endsWith('.yml') || file.endsWith('.yaml')) && !file.startsWith('._')
    );

    if (files.length === 0) {
      logger.warn('io.loadRandom.noFiles', { path: fullPath });
      return null;
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    return this.loadFile(path.join(folder, randomFile.replace(/\.(ya?ml)$/, '')));
  }

  /**
   * Load a file by numeric prefix from a folder
   * Matches files like "0017-some-title.yml" when given prefix "17"
   * @param {string} folder - Folder path relative to data dir
   * @param {string} prefix - Numeric prefix to match
   * @returns {object|null}
   */
  loadFileByPrefix(folder, prefix) {
    const dataDir = this.#ensureDataDir();
    const fullPath = path.join(dataDir, folder);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';
    const files = fs.readdirSync(fullPath).filter(file =>
      (file.endsWith('.yml') || file.endsWith('.yaml')) && !file.startsWith('._')
    );

    const matchingFile = files.find(file => {
      const match = file.match(/^(\d+)/);
      if (!match) return false;
      const fileNum = match[1].replace(/^0+/, '') || '0';
      return fileNum === normalizedPrefix;
    });

    if (!matchingFile) {
      return null;
    }

    return this.loadFile(path.join(folder, matchingFile.replace(/\.(ya?ml)$/, '')));
  }
}

// Singleton
export const ioService = new IOService();
export default ioService;
