/**
 * FreshVideoService
 *
 * Application layer service for orchestrating daily video downloads.
 * Coordinates file management, retention, and download execution via gateway.
 *
 * Key responsibilities:
 * - File locking to prevent concurrent runs
 * - Retention cleanup (remove old dated files)
 * - Invalid file cleanup (partial downloads)
 * - Orchestrate downloads via injected gateway
 *
 * NOTE: This service has NO knowledge of yt-dlp, YouTube URLs, or video codecs.
 * All platform-specific logic is delegated to the VideoSourceGateway adapter.
 *
 * @module applications/media/services/FreshVideoService
 */

import { nowTs24 } from '#system/utils/index.mjs';
import fs from 'fs';
import path from 'path';

/**
 * Application service for fresh video downloads
 */
export class FreshVideoService {
  #videoSourceGateway;
  #configLoader;
  #mediaPath;
  #logger;
  #options;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.videoSourceGateway - Gateway implementing IVideoSourceGateway
   * @param {Function} deps.configLoader - Function returning array of source configs
   * @param {string} deps.mediaPath - Base path for video storage
   * @param {Object} [deps.logger] - Logger instance
   * @param {Object} [deps.options] - Service options
   * @param {number} [deps.options.daysToKeep=10] - Days to retain videos
   * @param {number} [deps.options.processTimeout=300000] - Download timeout in ms
   * @param {string} [deps.options.audioLang='en'] - Preferred audio language
   * @param {number} [deps.options.lockStaleMs=3600000] - Lock file stale threshold (1 hour)
   */
  constructor({ videoSourceGateway, configLoader, mediaPath, logger, options = {} }) {
    if (!videoSourceGateway) {
      throw new Error('FreshVideoService requires videoSourceGateway');
    }
    if (!configLoader) {
      throw new Error('FreshVideoService requires configLoader');
    }
    if (!mediaPath) {
      throw new Error('FreshVideoService requires mediaPath');
    }

    this.#videoSourceGateway = videoSourceGateway;
    this.#configLoader = configLoader;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      processTimeout: 300000,
      audioLang: 'en',
      lockStaleMs: 60 * 60 * 1000,
      ...options
    };

    // Ensure media directory exists
    this.#ensureDir(this.#mediaPath);
  }

  /**
   * Ensure directory exists
   * @param {string} dirPath - Directory path
   */
  #ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Format date as YYYYMMDD
   * @param {Date} [date] - Date to format (defaults to now)
   * @returns {string} Formatted date
   */
  #formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /**
   * Calculate cutoff date for retention
   * @returns {string} Cutoff date as YYYYMMDD
   */
  #getCutoffDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.#options.daysToKeep);
    return this.#formatDate(date);
  }

  /**
   * Acquire file lock to prevent concurrent runs
   * @returns {Function|null} Release function or null if lock held
   */
  #acquireLock() {
    const lockFile = path.join(this.#mediaPath, 'freshvideo.lock');

    try {
      // Check for stale lock
      if (fs.existsSync(lockFile)) {
        const stat = fs.statSync(lockFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > this.#options.lockStaleMs) {
          this.#logger.warn?.('freshvideo.staleLock', {
            ageMins: Math.round(ageMs / 60000)
          });
          fs.unlinkSync(lockFile);
        }
      }

      // Atomic create using 'wx' flag
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({
        pid: process.pid,
        ts: nowTs24()
      }));
      fs.closeSync(fd);

      // Return release function
      return () => {
        try {
          fs.unlinkSync(lockFile);
        } catch (_) {
          // Ignore errors during cleanup
        }
      };
    } catch (e) {
      // Lock already held or creation failed
      return null;
    }
  }

  /**
   * Remove files older than retention period
   * @returns {string[]} Paths of deleted files
   */
  #cleanupOldFiles() {
    const deleted = [];
    const cutoff = this.#getCutoffDate();

    if (!fs.existsSync(this.#mediaPath)) return deleted;

    for (const folder of fs.readdirSync(this.#mediaPath)) {
      const folderPath = path.join(this.#mediaPath, folder);

      // Skip non-directories
      try {
        if (!fs.statSync(folderPath).isDirectory()) continue;
      } catch (_) {
        continue;
      }

      for (const file of fs.readdirSync(folderPath)) {
        const datePart = file.split('.')[0];

        // Delete files with date prefix older than cutoff
        if (datePart < cutoff) {
          const filePath = path.join(folderPath, file);
          try {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
            this.#logger.info?.('freshvideo.deletedOld', { path: filePath });
          } catch (e) {
            this.#logger.warn?.('freshvideo.deleteError', {
              path: filePath,
              error: e.message
            });
          }
        }
      }
    }

    return deleted;
  }

  /**
   * Remove files not matching valid pattern (partial downloads, temp files)
   * @param {string} dirPath - Directory to clean
   * @returns {number} Count of removed files
   */
  #cleanupInvalidFiles(dirPath) {
    const validPattern = /^\d{8}\.mp4$/;
    let count = 0;

    if (!fs.existsSync(dirPath)) return 0;

    for (const file of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, file);
      try {
        if (fs.statSync(filePath).isFile() && !validPattern.test(file)) {
          fs.unlinkSync(filePath);
          count++;
          this.#logger.debug?.('freshvideo.removedInvalid', { path: filePath });
        }
      } catch (_) {
        // Ignore errors during cleanup
      }
    }

    return count;
  }

  /**
   * Check if today's file already exists for a source
   * @param {string} providerDir - Directory for provider
   * @returns {string|null} File path if exists, null otherwise
   */
  #getTodayFile(providerDir) {
    const today = this.#formatDate();
    const todayFile = `${today}.mp4`;
    const filePath = path.join(providerDir, todayFile);

    return fs.existsSync(filePath) ? filePath : null;
  }

  /**
   * Download latest video from a source
   * @param {Object} source - Source configuration
   * @returns {Promise<{success: boolean, skipped?: boolean, filePath?: string, error?: string}>}
   */
  async #downloadSource(source) {
    const providerDir = path.join(this.#mediaPath, source.provider);
    this.#ensureDir(providerDir);

    // Check if already have today's file
    const existingFile = this.#getTodayFile(providerDir);
    if (existingFile) {
      this.#logger.info?.('freshvideo.alreadyExists', {
        provider: source.provider,
        path: existingFile
      });
      return {
        success: true,
        skipped: true,
        filePath: existingFile
      };
    }

    // Delegate to gateway
    const result = await this.#videoSourceGateway.downloadLatest(source, {
      outputDir: providerDir,
      timeoutMs: this.#options.processTimeout,
      preferredLang: this.#options.audioLang
    });

    if (result.success) {
      this.#logger.info?.('freshvideo.downloadSuccess', {
        provider: source.provider,
        filePath: result.filePath
      });
    } else {
      this.#logger.error?.('freshvideo.downloadFailed', {
        provider: source.provider,
        error: result.error
      });
    }

    return result;
  }

  /**
   * Get list of all valid video files within retention period
   * @returns {string[]} Array of file paths
   */
  #getValidFiles() {
    const files = [];
    const cutoff = this.#getCutoffDate();

    if (!fs.existsSync(this.#mediaPath)) return files;

    for (const folder of fs.readdirSync(this.#mediaPath)) {
      const folderPath = path.join(this.#mediaPath, folder);

      try {
        if (!fs.statSync(folderPath).isDirectory()) continue;
      } catch (_) {
        continue;
      }

      for (const file of fs.readdirSync(folderPath)) {
        if (file.endsWith('.mp4')) {
          const datePart = file.split('.')[0];
          if (datePart >= cutoff) {
            files.push(path.join(folderPath, file));
          }
        }
      }
    }

    return files;
  }

  /**
   * Run the download job
   * @returns {Promise<Object>} Job result
   */
  async run() {
    // Acquire lock
    const releaseLock = this.#acquireLock();
    if (!releaseLock) {
      this.#logger.warn?.('freshvideo.lockHeld', {
        message: 'Another instance is running'
      });
      return {
        skipped: true,
        reason: 'lock_held',
        deleted: [],
        providers: [],
        files: []
      };
    }

    try {
      // Load source configuration
      const sources = await this.#configLoader();
      if (!Array.isArray(sources) || sources.length === 0) {
        this.#logger.warn?.('freshvideo.noConfig', {
          message: 'No sources configured'
        });
        return {
          skipped: true,
          reason: 'no_config',
          deleted: [],
          providers: [],
          files: []
        };
      }

      // Cleanup old files
      const deleted = this.#cleanupOldFiles();

      // Cleanup invalid files in base directory
      this.#cleanupInvalidFiles(this.#mediaPath);

      // Download each source
      const providers = [];
      const results = [];

      for (const source of sources) {
        const result = await this.#downloadSource(source);
        providers.push(source.provider);
        results.push({
          provider: source.provider,
          ...result
        });

        // Cleanup invalid files in provider directory after each download
        const providerDir = path.join(this.#mediaPath, source.provider);
        this.#cleanupInvalidFiles(providerDir);
      }

      // Get final file list
      const files = this.#getValidFiles();

      return {
        skipped: false,
        deleted,
        providers,
        files,
        results
      };

    } finally {
      releaseLock();
    }
  }
}

export default FreshVideoService;
