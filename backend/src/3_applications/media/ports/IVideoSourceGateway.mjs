/**
 * Abstract interface for downloading videos from external sources.
 *
 * Implementations: YtDlpAdapter (YouTube, Vimeo, etc.)
 *
 * @module applications/media/ports/IVideoSourceGateway
 */

/**
 * @typedef {Object} VideoSource
 * @property {string} provider - Content provider identifier (cnn, bbc)
 * @property {string} src - Platform (youtube, vimeo)
 * @property {string} type - Source type (channel, playlist)
 * @property {string} id - Platform-specific identifier
 */

/**
 * @typedef {Object} DownloadOptions
 * @property {string} outputDir - Directory to save video
 * @property {number} [maxHeight=720] - Maximum video height
 * @property {string} [preferredLang='en'] - Preferred audio language
 * @property {number} [timeoutMs=300000] - Download timeout
 */

/**
 * @typedef {Object} DownloadResult
 * @property {boolean} success
 * @property {string} [filePath] - Path to downloaded file (if success)
 * @property {string} [uploadDate] - Video upload date YYYYMMDD (if available)
 * @property {string} [error] - Error message (if failed)
 */

/**
 * Video source gateway interface shape
 */
export const IVideoSourceGateway = {
  /**
   * Download the latest video from a source
   * @param {VideoSource} source - Source configuration
   * @param {DownloadOptions} options - Download options
   * @returns {Promise<DownloadResult>}
   */
  async downloadLatest(source, options) {},
};

/**
 * Type guard for VideoSourceGateway
 * @param {Object} obj
 * @returns {boolean}
 */
export function isVideoSourceGateway(obj) {
  return obj && typeof obj.downloadLatest === 'function';
}
