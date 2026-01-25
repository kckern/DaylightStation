/**
 * YouTubeDownloadService
 *
 * Downloads latest videos from configured YouTube channels/playlists.
 * Used for daily news/content downloads.
 *
 * Features:
 * - Downloads single latest video per channel
 * - Cleans up old files (configurable retention)
 * - File locking to prevent concurrent runs
 * - Retry with fallback format options
 * - Codec verification with ffprobe
 *
 * @module domains/media/services/YouTubeDownloadService
 */

import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const exec = promisify(child_process.exec);

/**
 * YouTube download service for scheduled video downloads
 */
export class YouTubeDownloadService {
  #configLoader;
  #mediaPath;
  #logger;
  #options;

  /**
   * @param {Object} config
   * @param {Function} config.configLoader - Function to load youtube config (returns array of channel configs)
   * @param {string} config.mediaPath - Base path for video storage
   * @param {Object} [config.logger] - Logger instance
   * @param {Object} [config.options] - Service options
   * @param {number} [config.options.daysToKeep=10] - Days to retain videos
   * @param {number} [config.options.processTimeout=300000] - Download timeout in ms
   * @param {number} [config.options.retryDelay=5000] - Delay between retries in ms
   * @param {string} [config.options.audioLang='en'] - Preferred audio language
   */
  constructor({ configLoader, mediaPath, logger, options = {} }) {
    if (!configLoader) throw new Error('YouTubeDownloadService requires configLoader');
    if (!mediaPath) throw new Error('YouTubeDownloadService requires mediaPath');

    this.#configLoader = configLoader;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      processTimeout: 300000,
      retryDelay: 5000,
      audioLang: 'en',
      maxAttempts: 3,
      lockStaleMs: 60 * 60 * 1000,
      ...options
    };

    // Ensure media directory exists
    this.#ensureDir(this.#mediaPath);
  }

  #ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  #formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

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
    const lockFile = path.join(this.#mediaPath, 'youtube.lock');

    try {
      // Check for stale lock
      if (fs.existsSync(lockFile)) {
        const stat = fs.statSync(lockFile);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > this.#options.lockStaleMs) {
          this.#logger.warn?.('youtube.staleLock', { ageMins: Math.round(ageMs / 60000) });
          fs.unlinkSync(lockFile);
        }
      }

      // Atomic create
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: nowTs24() }));
      fs.closeSync(fd);

      return () => {
        try { fs.unlinkSync(lockFile); } catch (_) {}
      };
    } catch (e) {
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
      if (!fs.statSync(folderPath).isDirectory()) continue;

      for (const file of fs.readdirSync(folderPath)) {
        const datePart = file.split('.')[0];
        if (datePart < cutoff) {
          const filePath = path.join(folderPath, file);
          try {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
            this.#logger.info?.('youtube.deletedOld', { path: filePath });
          } catch (e) {
            this.#logger.warn?.('youtube.deleteError', { path: filePath, error: e.message });
          }
        }
      }
    }

    return deleted;
  }

  /**
   * Remove invalid/partial files from a directory
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
          this.#logger.debug?.('youtube.removedInvalid', { path: filePath });
        }
      } catch (_) {}
    }

    return count;
  }

  /**
   * Verify video has valid codec
   * @param {string} filePath - Path to video file
   * @returns {Promise<boolean>}
   */
  async #verifyCodec(filePath) {
    try {
      const { stdout } = await exec(
        `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`
      );
      return stdout.trim().length > 0;
    } catch (e) {
      this.#logger.warn?.('youtube.ffprobeError', { path: filePath, error: e.message });
      return false;
    }
  }

  /**
   * Get yt-dlp parameters for a download attempt
   * @param {number} attempt - Attempt number (1-based)
   * @returns {string} yt-dlp parameters
   */
  #getDownloadParams(attempt) {
    const langArgs = `--extractor-args "youtube:lang=${this.#options.audioLang}"`;

    const options = [
      // Attempt 1 - HEVC/AVC preference with fallback
      `${langArgs} -f 'bestvideo[vcodec^=hevc][height<=720]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=720]+bestaudio[ext=m4a]/best[height<=720]' --remux-video mp4`,
      // Attempt 2 - Simple best video + audio
      `${langArgs} -f 'bestvideo[height<=720]+bestaudio/best[height<=720]' --remux-video mp4`,
      // Attempt 3 - Just best available
      `${langArgs} -f 'best[height<=1080]' --remux-video mp4`,
    ];

    return options[Math.min(attempt - 1, options.length - 1)];
  }

  /**
   * Execute yt-dlp command with timeout
   * @param {string} command - Command to execute
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  #executeYtDlp(command) {
    return new Promise((resolve, reject) => {
      const child = child_process.exec(`exec ${command}`, (error, stdout, stderr) => {
        if (error) return reject(error);
        return resolve({ stdout, stderr });
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Process timeout after ${this.#options.processTimeout}ms`));
      }, this.#options.processTimeout);

      child.on('exit', () => clearTimeout(timer));
    });
  }

  /**
   * Download latest video for a channel/playlist
   * @param {Object} config - Channel config
   * @param {string} config.shortcode - Short identifier
   * @param {string} config.type - 'Channel' or 'Playlist'
   * @param {string} config.playlist - Channel/playlist ID or URL
   * @returns {Promise<{success: boolean, filePath?: string}>}
   */
  async #downloadChannel(config) {
    const { shortcode, type, playlist } = config;
    const today = this.#formatDate();
    const todayFile = `${today}.mp4`;
    const dirPath = path.join(this.#mediaPath, shortcode);
    const filePath = path.join(dirPath, todayFile);

    this.#ensureDir(dirPath);

    // Skip if already downloaded
    if (fs.existsSync(filePath)) {
      this.#logger.info?.('youtube.alreadyExists', { shortcode, file: todayFile });
      return { success: true, filePath, skipped: true };
    }

    const inputUrl = type === 'Channel'
      ? `https://www.youtube.com/channel/${playlist}`
      : playlist;

    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt++) {
      const params = this.#getDownloadParams(attempt);
      const outputPath = `${dirPath}/%(upload_date)s.%(ext)s`;
      const cmd = `yt-dlp ${params} -o "${outputPath}" --max-downloads 1 --playlist-end 1 "${inputUrl}"`;

      this.#logger.info?.('youtube.downloadAttempt', { shortcode, attempt, maxAttempts: this.#options.maxAttempts });

      try {
        await this.#executeYtDlp(cmd);

        // Small delay for filesystem
        await new Promise(r => setTimeout(r, 1000));

        if (fs.existsSync(filePath)) {
          const validCodec = await this.#verifyCodec(filePath);
          if (validCodec) {
            this.#logger.info?.('youtube.downloadSuccess', { shortcode, file: todayFile });
            return { success: true, filePath };
          } else {
            fs.unlinkSync(filePath);
            this.#logger.warn?.('youtube.invalidCodec', { shortcode, file: todayFile });
          }
        }
      } catch (e) {
        this.#logger.warn?.('youtube.downloadError', { shortcode, attempt, error: e.message });
      }

      if (attempt < this.#options.maxAttempts) {
        this.#cleanupInvalidFiles(dirPath);
        await new Promise(r => setTimeout(r, this.#options.retryDelay));
      }
    }

    this.#cleanupInvalidFiles(dirPath);
    this.#logger.error?.('youtube.downloadFailed', { shortcode, attempts: this.#options.maxAttempts });
    return { success: false };
  }

  /**
   * Get list of all valid video files
   * @returns {string[]} Array of file paths
   */
  #getValidFiles() {
    const files = [];
    const cutoff = this.#getCutoffDate();

    if (!fs.existsSync(this.#mediaPath)) return files;

    for (const folder of fs.readdirSync(this.#mediaPath)) {
      const folderPath = path.join(this.#mediaPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

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
    const releaseLock = this.#acquireLock();
    if (!releaseLock) {
      this.#logger.warn?.('youtube.lockHeld', { message: 'Another instance is running' });
      return { skipped: true, reason: 'lock_held', deleted: [], shortcodes: [], files: [] };
    }

    try {
      const config = await this.#configLoader();
      if (!Array.isArray(config) || config.length === 0) {
        this.#logger.warn?.('youtube.noConfig', { message: 'No channels configured' });
        return { skipped: true, reason: 'no_config', deleted: [], shortcodes: [], files: [] };
      }

      // Cleanup old files
      const deleted = this.#cleanupOldFiles();
      this.#cleanupInvalidFiles(this.#mediaPath);

      // Download each channel
      const shortcodes = [];
      const results = [];

      for (const channelConfig of config) {
        const result = await this.#downloadChannel(channelConfig);
        shortcodes.push(channelConfig.shortcode);
        results.push({ shortcode: channelConfig.shortcode, ...result });
      }

      // Get final file list
      const files = this.#getValidFiles();

      return {
        skipped: false,
        deleted,
        shortcodes,
        files,
        results
      };
    } finally {
      releaseLock();
    }
  }
}

export default YouTubeDownloadService;
