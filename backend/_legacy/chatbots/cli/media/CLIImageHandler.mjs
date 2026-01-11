/**
 * CLI Image Handler
 * @module cli/media/CLIImageHandler
 * 
 * Handles saving images to the /tmp folder for CLI mode.
 */

import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * CLI Image Handler - saves images to temporary directory
 */
export class CLIImageHandler {
  #tmpDir;
  #imageCounter;
  #logger;

  /**
   * @param {Object} [options]
   * @param {string} [options.tmpDir] - Temporary directory path
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#tmpDir = options.tmpDir || '/tmp/chatbot-cli/images';
    this.#imageCounter = 0;
    this.#logger = options.logger || createLogger({ source: 'cli:image', app: 'cli' });
  }

  /**
   * Initialize the handler (ensure tmp directory exists)
   */
  async initialize() {
    try {
      await fs.mkdir(this.#tmpDir, { recursive: true });
      this.#logger.debug('imageHandler.initialized', { tmpDir: this.#tmpDir });
    } catch (error) {
      this.#logger.error('imageHandler.initError', { error: error.message });
      throw error;
    }
  }

  /**
   * Save a Buffer as an image file
   * @param {Buffer} buffer - Image data
   * @param {string} [filename] - Optional filename
   * @returns {Promise<string>} - Saved file path
   */
  async saveBuffer(buffer, filename) {
    await this.initialize();
    
    const finalFilename = filename || this.#generateFilename('image', 'png');
    const filePath = path.join(this.#tmpDir, finalFilename);
    
    await fs.writeFile(filePath, buffer);
    
    this.#logger.debug('imageHandler.savedBuffer', { filePath, size: buffer.length });
    
    return filePath;
  }

  /**
   * Download an image from URL and save to tmp
   * @param {string} url - Image URL
   * @returns {Promise<string>} - Saved file path
   */
  async downloadImage(url) {
    await this.initialize();
    
    return new Promise((resolve, reject) => {
      const filename = this.#generateFilename('download', this.#getExtensionFromUrl(url));
      const filePath = path.join(this.#tmpDir, filename);
      
      const protocol = url.startsWith('https') ? https : http;
      
      const request = protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Follow redirect
          this.downloadImage(response.headers.location)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            await fs.writeFile(filePath, buffer);
            this.#logger.debug('imageHandler.downloaded', { url, filePath, size: buffer.length });
            resolve(filePath);
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Copy a local file to tmp directory
   * @param {string} sourcePath - Source file path
   * @returns {Promise<string>} - Copied file path
   */
  async copyFile(sourcePath) {
    await this.initialize();
    
    const ext = path.extname(sourcePath) || '.png';
    const filename = this.#generateFilename('copy', ext.slice(1));
    const destPath = path.join(this.#tmpDir, filename);
    
    await fs.copyFile(sourcePath, destPath);
    
    this.#logger.debug('imageHandler.copied', { sourcePath, destPath });
    
    return destPath;
  }

  /**
   * Save base64 encoded image
   * @param {string} base64Data - Base64 encoded image data
   * @param {string} [mimeType='image/png'] - MIME type
   * @returns {Promise<string>} - Saved file path
   */
  async saveBase64(base64Data, mimeType = 'image/png') {
    const ext = this.#getExtensionFromMime(mimeType);
    const buffer = Buffer.from(base64Data, 'base64');
    
    return this.saveBuffer(buffer, this.#generateFilename('base64', ext));
  }

  /**
   * Get the tmp directory path
   * @returns {string}
   */
  getTmpDir() {
    return this.#tmpDir;
  }

  /**
   * Clean up old images (older than maxAge)
   * @param {number} [maxAgeMs=3600000] - Max age in milliseconds (default 1 hour)
   * @returns {Promise<number>} - Number of files deleted
   */
  async cleanup(maxAgeMs = 3600000) {
    try {
      const files = await fs.readdir(this.#tmpDir);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.#tmpDir, file);
        const stat = await fs.stat(filePath);
        
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      this.#logger.debug('imageHandler.cleanup', { deleted, total: files.length });
      return deleted;
    } catch (error) {
      this.#logger.error('imageHandler.cleanupError', { error: error.message });
      return 0;
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Generate a unique filename
   * @private
   */
  #generateFilename(prefix, ext) {
    const timestamp = Date.now();
    const counter = ++this.#imageCounter;
    return `${prefix}-${timestamp}-${counter}.${ext}`;
  }

  /**
   * Get file extension from URL
   * @private
   */
  #getExtensionFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).slice(1);
      return ext || 'png';
    } catch {
      return 'png';
    }
  }

  /**
   * Get file extension from MIME type
   * @private
   */
  #getExtensionFromMime(mimeType) {
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return mimeToExt[mimeType] || 'png';
  }
}

export default CLIImageHandler;
