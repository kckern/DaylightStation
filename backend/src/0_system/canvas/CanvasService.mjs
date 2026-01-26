/**
 * Canvas Service
 * @module 0_system/canvas/CanvasService
 *
 * System-level service for canvas instance management.
 * Handles font registration and canvas creation.
 */

import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

/**
 * Canvas service for creating and managing canvas instances
 */
export class CanvasService {
  #fontDir;
  #registeredFonts = new Set();
  #logger;

  /**
   * @param {Object} options
   * @param {string} options.fontDir - Path to fonts directory
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ fontDir, logger = console }) {
    if (!fontDir) {
      throw new Error('CanvasService requires fontDir');
    }
    this.#fontDir = fontDir;
    this.#logger = logger;
  }

  /**
   * Register a font for canvas rendering
   * @param {string} fontPath - Relative path from fontDir (e.g., 'roboto-condensed/RobotoCondensed-Regular.ttf')
   * @param {string} family - Font family name
   * @returns {boolean} Whether registration succeeded
   */
  registerFont(fontPath, family) {
    const fullPath = path.join(this.#fontDir, fontPath);
    const key = `${fullPath}:${family}`;

    if (this.#registeredFonts.has(key)) {
      return true;
    }

    if (!fs.existsSync(fullPath)) {
      this.#logger.warn?.('canvas.font.notFound', { path: fullPath });
      return false;
    }

    try {
      registerFont(fullPath, { family });
      this.#registeredFonts.add(key);
      this.#logger.debug?.('canvas.font.registered', { family, path: fullPath });
      return true;
    } catch (error) {
      this.#logger.warn?.('canvas.font.failed', { family, error: error.message });
      return false;
    }
  }

  /**
   * Create a new canvas instance
   * @param {number} width - Canvas width in pixels
   * @param {number} height - Canvas height in pixels
   * @returns {Canvas} Node-canvas instance
   */
  create(width, height) {
    return createCanvas(width, height);
  }

  /**
   * Create a canvas and return with 2D context
   * @param {number} width - Canvas width in pixels
   * @param {number} height - Canvas height in pixels
   * @returns {{ canvas: Canvas, ctx: CanvasRenderingContext2D }}
   */
  createWithContext(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }
}

export default CanvasService;
