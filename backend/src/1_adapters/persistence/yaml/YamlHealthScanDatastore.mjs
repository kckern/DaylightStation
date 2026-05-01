/**
 * YamlHealthScanDatastore (F-006 persistence)
 *
 * YAML-backed adapter that reads/writes body-composition scan records under
 * `${dataDir}/users/${userId}/lifelog/archives/scans/`. Each scan is a separate
 * file named `${date}-${source}.yml` (collision-resistant when multiple
 * sources record on the same day, e.g. an InBody and a DEXA).
 *
 * Notes:
 *   - userId is hardened via HealthArchiveScope.assertValidUserId to block
 *     path-traversal before any I/O.
 *   - js-yaml's default schema coerces unquoted ISO dates (`2024-01-15`) to
 *     JS Date instances. We load with JSON_SCHEMA which preserves them as
 *     strings — matching what HealthScan expects.
 *   - Filenames passed to fs include the explicit `.yml` extension; we never
 *     rely on path.extname-based extension inference (per the dotted-filename
 *     gotcha noted in MEMORY.md).
 *   - Malformed YAML and schema-invalid scans are skipped with a warn log
 *     rather than crashing listScans — the adapter must be robust to a
 *     single corrupt file in the directory.
 *
 * @module adapters/persistence/yaml
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

import { HealthScan } from '#domains/health/entities/HealthScan.mjs';
import { HealthArchiveScope } from '#domains/health/services/HealthArchiveScope.mjs';
import { IHealthScanDatastore } from '#apps/health/ports/IHealthScanDatastore.mjs';

const SCAN_FILE_EXT = '.yml';

export class YamlHealthScanDatastore extends IHealthScanDatastore {
  #dataDir;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.dataDir - Absolute path to the data root (parent of `users/`).
   * @param {Object} [config.logger] - Logger with debug/info/warn/error methods.
   */
  constructor(config = {}) {
    super();
    if (!config.dataDir) {
      throw new Error('YamlHealthScanDatastore requires dataDir');
    }
    this.#dataDir = config.dataDir;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Resolve the per-user scans directory after validating userId.
   * @private
   */
  #scansDir(userId) {
    HealthArchiveScope.assertValidUserId(userId);
    return path.join(
      this.#dataDir,
      'users',
      userId,
      'lifelog',
      'archives',
      'scans',
    );
  }

  /**
   * List `.yml` files in a directory. Returns [] when the directory is missing.
   * @private
   */
  async #listYamlFiles(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return entries.filter((name) => name.endsWith(SCAN_FILE_EXT));
  }

  /**
   * Load a single scan file, returning null on read or parse failure.
   * @private
   */
  async #loadScan(dir, filename) {
    const fullPath = path.join(dir, filename);
    let content;
    try {
      content = await fs.readFile(fullPath, 'utf8');
    } catch (err) {
      this.#logger.warn?.('health.scan.read_failed', {
        file: filename,
        error: err.message,
      });
      return null;
    }

    let raw;
    try {
      // JSON_SCHEMA preserves dates as strings (default schema would coerce
      // unquoted `2024-01-15` to a JS Date and break HealthScan validation).
      raw = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (err) {
      this.#logger.warn?.('health.scan.parse_failed', {
        file: filename,
        error: err.message,
      });
      return null;
    }

    try {
      return new HealthScan(raw);
    } catch (err) {
      this.#logger.warn?.('health.scan.invalid', {
        file: filename,
        error: err.message,
      });
      return null;
    }
  }

  // ===========================================================================
  // IHealthScanDatastore implementation
  // ===========================================================================

  /**
   * List all scans for a user, sorted by date ascending.
   * @param {string} userId
   * @returns {Promise<HealthScan[]>}
   */
  async listScans(userId) {
    const dir = this.#scansDir(userId);
    const filenames = await this.#listYamlFiles(dir);

    const scans = [];
    for (const filename of filenames) {
      const scan = await this.#loadScan(dir, filename);
      if (scan) scans.push(scan);
    }

    scans.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return scans;
  }

  /**
   * @param {string} userId
   * @returns {Promise<HealthScan|null>}
   */
  async getLatestScan(userId) {
    const scans = await this.listScans(userId);
    if (scans.length === 0) return null;
    return scans[scans.length - 1];
  }

  /**
   * @param {string} userId
   * @param {HealthScan} scan
   * @returns {Promise<void>}
   */
  async saveScan(userId, scan) {
    if (!(scan instanceof HealthScan)) {
      throw new TypeError('saveScan requires HealthScan instance');
    }
    const dir = this.#scansDir(userId);
    // Always include the explicit `.yml` extension — never let any downstream
    // helper infer it from the source string (which may legitimately contain
    // characters that look like an extension to `path.extname`).
    const filename = `${scan.date}-${scan.source}${SCAN_FILE_EXT}`;
    const fullPath = path.join(dir, filename);

    await fs.mkdir(dir, { recursive: true });
    const yamlText = yaml.dump(scan.serialize(), { lineWidth: 120, noRefs: true });
    await fs.writeFile(fullPath, yamlText, 'utf8');

    this.#logger.debug?.('health.scan.saved', {
      userId,
      file: filename,
    });
  }

  /**
   * Delete every scan file matching `${date}-*.yml` in the user's scans dir.
   * Idempotent — silently no-ops when the directory or files are missing.
   * @param {string} userId
   * @param {string} date YYYY-MM-DD
   * @returns {Promise<void>}
   */
  async deleteScan(userId, date) {
    const dir = this.#scansDir(userId);
    const filenames = await this.#listYamlFiles(dir);
    const prefix = `${date}-`;
    const matches = filenames.filter((name) => name.startsWith(prefix));

    for (const filename of matches) {
      const fullPath = path.join(dir, filename);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    this.#logger.debug?.('health.scan.deleted', {
      userId,
      date,
      count: matches.length,
    });
  }
}

export default YamlHealthScanDatastore;
