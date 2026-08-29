// backend/src/3_applications/fitness/services/ScreenshotService.mjs

/**
 * ScreenshotService
 *
 * Application-layer service for saving fitness session screenshots.
 * Coordinates capture persistence with session snapshot tracking.
 *
 * Extracted from the fitness API router to keep HTTP-layer code
 * focused on req/res handling only.
 *
 * @module applications/fitness/services
 */
export class ScreenshotService {
  #screenshotStore;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.screenshotStore - Semantic screenshot persistence
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ screenshotStore, logger = console }) {
    if (!screenshotStore) {
      throw new Error('ScreenshotService requires screenshotStore');
    }
    this.#screenshotStore = screenshotStore;
    this.#logger = logger;
  }

  /**
   * Save a session capture from the transport-provided image representation.
   *
   * @param {Object} params
   * @param {string} params.sessionId - Session ID
   * @param {string} params.image - Encoded image representation
   * @param {string} [params.mediaType] - Declared media type
   * @param {number} [params.index] - Capture index for ordering
   * @param {number} [params.timestamp] - Capture timestamp (defaults to Date.now())
   * @param {string} [params.householdId] - Household ID
   * @returns {Promise<Object>} Semantic capture receipt
   * @throws {ScreenshotValidationError} If sessionId is invalid or image data can't be decoded
   */
  async saveScreenshot({ sessionId, image, mediaType, index, timestamp, householdId, role = 'camera' }) {
    const captureRole = role === 'player' ? 'player' : 'camera';
    const stored = await this.#screenshotStore.saveCapture({
      sessionId, householdId, role: captureRole, index, image, mediaType, timestamp,
    });
    if (!stored) throw new ScreenshotValidationError('Invalid sessionId');
    if (stored.kind === 'invalid_encoding') {
      throw new ScreenshotValidationError('Invalid image payload', stored.reason);
    }
    this.#logger.debug?.('fitness.screenshot.saved', {
      sessionId, bytes: stored.capture.byteLength, role: captureRole,
    });
    return stored;
  }
}

/**
 * Validation error for screenshot operations
 */
export class ScreenshotValidationError extends Error {
  constructor(message, reason = null) {
    super(message);
    this.name = 'ScreenshotValidationError';
    this.reason = reason;
  }
}
