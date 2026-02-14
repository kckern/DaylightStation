// backend/src/3_applications/fitness/services/ScreenshotService.mjs

import path from 'path';

/**
 * ScreenshotService
 *
 * Application-layer service for saving fitness session screenshots.
 * Handles base64 decoding, MIME normalization, file writing, and
 * session snapshot tracking.
 *
 * Extracted from the fitness API router to keep HTTP-layer code
 * focused on req/res handling only.
 *
 * @module applications/fitness/services
 */
export class ScreenshotService {
  #sessionService;
  #fileIO;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.sessionService - SessionService for session lookups and snapshot updates
   * @param {Object} deps.fileIO - File I/O utilities ({ ensureDir, writeBinary })
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ sessionService, fileIO, logger = console }) {
    if (!sessionService) {
      throw new Error('ScreenshotService requires sessionService');
    }
    if (!fileIO) {
      throw new Error('ScreenshotService requires fileIO');
    }
    this.#sessionService = sessionService;
    this.#fileIO = fileIO;
    this.#logger = logger;
  }

  /**
   * Save a session screenshot from base64-encoded image data.
   *
   * @param {Object} params
   * @param {string} params.sessionId - Session ID
   * @param {string} params.imageBase64 - Base64-encoded image (optionally with data URI prefix)
   * @param {string} [params.mimeType] - MIME type (e.g. 'image/png')
   * @param {number} [params.index] - Capture index for ordering
   * @param {number} [params.timestamp] - Capture timestamp (defaults to Date.now())
   * @param {string} [params.householdId] - Household ID
   * @returns {Promise<Object>} Result with { filename, path, size, index, timestamp, sessionId, mimeType }
   * @throws {ScreenshotValidationError} If sessionId is invalid or image data can't be decoded
   */
  async saveScreenshot({ sessionId, imageBase64, mimeType, index, timestamp, householdId }) {
    // Resolve storage paths from session service
    const paths = this.#sessionService.getStoragePaths(sessionId, householdId);
    if (!paths) {
      throw new ScreenshotValidationError('Invalid sessionId');
    }

    // Decode base64 (strip optional data URI prefix)
    const trimmed = imageBase64.replace(/^data:[^;]+;base64,/, '');
    if (!trimmed) {
      throw new ScreenshotValidationError('Invalid base64 payload');
    }

    const buffer = Buffer.from(trimmed, 'base64');
    if (!buffer.length) {
      throw new ScreenshotValidationError('Failed to decode image data');
    }

    // Determine file extension from MIME type
    const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
    const extension = normalizedMime.includes('png') ? 'png'
      : normalizedMime.includes('webp') ? 'webp'
      : normalizedMime.includes('jpeg') || normalizedMime.includes('jpg') ? 'jpg'
      : 'jpg';

    // Build filename with zero-padded index or timestamp-based fallback
    const indexValue = Number.isFinite(index) ? Number(index) : null;
    const indexFragment = indexValue != null
      ? String(indexValue).padStart(4, '0')
      : Date.now().toString(36);
    const filename = `${paths.sessionDate}_${indexFragment}.${extension}`;

    // Ensure screenshot directory exists
    this.#fileIO.ensureDir(paths.screenshotsDir);

    // Write binary file
    const filePath = path.join(paths.screenshotsDir, filename);
    this.#fileIO.writeBinary(filePath, buffer);

    const relativePath = `${paths.screenshotsRelativeBase}/${filename}`;

    // Use provided timestamp or current time
    const captureTimestamp = timestamp || Date.now();

    const captureInfo = {
      index: indexValue,
      filename,
      path: relativePath,
      timestamp: captureTimestamp,
      size: buffer.length
    };

    // Update session with snapshot record
    await this.#sessionService.addSnapshot(sessionId, captureInfo, householdId, captureTimestamp);

    this.#logger.debug?.('fitness.screenshot.saved', {
      sessionId,
      filename,
      size: buffer.length
    });

    return {
      sessionId: paths.sessionDate.replace(/-/g, '') + (sessionId.slice(8) || ''),
      ...captureInfo,
      mimeType: normalizedMime || 'image/jpeg'
    };
  }
}

/**
 * Validation error for screenshot operations
 */
export class ScreenshotValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScreenshotValidationError';
  }
}
