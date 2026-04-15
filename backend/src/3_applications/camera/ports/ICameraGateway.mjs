/**
 * ICameraGateway Port - Camera discovery and access
 *
 * Abstraction for listing cameras, fetching snapshots, and resolving stream URLs.
 * Implemented by adapters that integrate with camera systems (e.g., Frigate).
 *
 * @module applications/camera/ports
 */

/**
 * @typedef {Object} CameraInfo
 * @property {string} id - Camera identifier
 * @property {string} name - Display name
 * @property {boolean} enabled - Whether camera is active
 */

/**
 * @typedef {Object} SnapshotResult
 * @property {Buffer} buffer - Image data
 * @property {string} contentType - MIME type (e.g., 'image/jpeg')
 */

/**
 * Check if object implements ICameraGateway
 * @param {any} obj
 * @returns {boolean}
 */
export function isCameraGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.listCameras === 'function' &&
    typeof obj.getCamera === 'function' &&
    typeof obj.fetchSnapshot === 'function' &&
    typeof obj.getStreamUrl === 'function'
  );
}

/**
 * Assert that object implements ICameraGateway
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertCameraGateway(obj, context = 'CameraGateway') {
  if (!isCameraGateway(obj)) {
    throw new Error(`${context} must implement ICameraGateway interface`);
  }
}

/**
 * Create a no-op camera gateway (for environments without camera integration)
 * @returns {Object}
 */
export function createNoOpCameraGateway() {
  return {
    listCameras: async () => [],
    getCamera: async () => null,
    fetchSnapshot: async () => null,
    getStreamUrl: () => null
  };
}

export default {
  isCameraGateway,
  assertCameraGateway,
  createNoOpCameraGateway
};
