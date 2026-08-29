/**
 * Abstract interface for downloading videos from external sources.
 *
 * @module applications/media/ports/IVideoSourceGateway
 */

/**
 * @typedef {Object} VideoSource
 * @property {string} provider - Content provider identifier
 * @property {unknown} sourceRef - Opaque adapter-owned source locator
 */

/**
 * @typedef {Object} DownloadOptions
 * @property {number} [maxHeight=720] - Maximum video height
 * @property {string} [preferredLang='en'] - Preferred audio language
 * @property {number} [timeoutMs=300000] - Download timeout
 */

/**
 * @typedef {Object} DownloadResult
 * @property {'downloaded'|'failed'} kind
 * @property {string} [assetId] - Stable semantic identifier for the downloaded asset
 * @property {string} [uploadDate] - Video upload date YYYYMMDD (if available)
 * @property {string} [error] - Error message (if failed)
 */

/**
 * Video source gateway interface shape
 */
export class IVideoSourceGateway {
  /**
   * Download the latest video from a source
   * @param {VideoSource} source - Source configuration
   * @param {DownloadOptions} options - Download options
   * @returns {Promise<DownloadResult>} Path-free adapter outcome
   */
  async downloadLatest(_source, _options) { throw new Error('IVideoSourceGateway.downloadLatest not implemented'); }
}

/**
 * Type guard for VideoSourceGateway
 * @param {Object} obj
 * @returns {boolean}
 */
export function isVideoSourceGateway(obj) {
  return obj && typeof obj.downloadLatest === 'function';
}
