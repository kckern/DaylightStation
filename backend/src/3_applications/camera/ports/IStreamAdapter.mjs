/**
 * IStreamAdapter Port - RTSP-to-HLS stream management
 *
 * Abstraction for starting, stopping, and managing live video streams.
 * Implemented by adapters that transcode RTSP to HLS (e.g., FFmpeg).
 *
 * @module applications/camera/ports
 */

/**
 * Check if object implements IStreamAdapter
 * @param {any} obj
 * @returns {boolean}
 */
export function isStreamAdapter(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.ensureStream === 'function' &&
    typeof obj.touch === 'function' &&
    typeof obj.stop === 'function' &&
    typeof obj.stopAll === 'function' &&
    typeof obj.isActive === 'function'
  );
}

/**
 * Assert that object implements IStreamAdapter
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertStreamAdapter(obj, context = 'StreamAdapter') {
  if (!isStreamAdapter(obj)) {
    throw new Error(`${context} must implement IStreamAdapter interface`);
  }
}

/**
 * Create a no-op stream adapter (for environments without stream support)
 * @returns {Object}
 */
export function createNoOpStreamAdapter() {
  return {
    ensureStream: async () => null,
    touch: () => {},
    stop: () => {},
    stopAll: () => {},
    isActive: () => false
  };
}

export default {
  isStreamAdapter,
  assertStreamAdapter,
  createNoOpStreamAdapter
};
