/**
 * IMediaStorageRepository - Port interface for media file storage operations
 *
 * Abstracts file system operations for the media application layer.
 * Implementations handle the actual storage (local fs, S3, etc.)
 *
 * @module applications/media/ports/IMediaStorageRepository
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} path - Full file path
 * @property {string} name - File name
 * @property {string} datePrefix - Date prefix (YYYYMMDD) extracted from name
 * @property {number} mtimeMs - Last modified timestamp
 */

/**
 * @typedef {Object} LockResult
 * @property {boolean} acquired - Whether lock was acquired
 * @property {Function} [release] - Release function (if acquired)
 */

/**
 * @typedef {Object} ListFilesOptions
 * @property {string} [extension] - Filter by file extension (e.g., '.mp4')
 * @property {RegExp} [pattern] - Filter by filename pattern
 */

/**
 * @typedef {Object} AcquireLockOptions
 * @property {number} [staleMs] - Lock stale threshold in milliseconds
 */

/**
 * @typedef {Object} StatResult
 * @property {boolean} isFile - Whether path is a file
 * @property {boolean} isDirectory - Whether path is a directory
 * @property {number} mtimeMs - Last modified timestamp in milliseconds
 * @property {number} size - Size in bytes
 */

/**
 * Media storage repository interface shape
 */
export const IMediaStorageRepository = {
  /**
   * Ensure directory exists, creating it recursively if needed
   * @param {string} dirPath - Directory path to ensure
   * @returns {Promise<void>}
   */
  async ensureDir(dirPath) {},

  /**
   * Check if a file or directory exists
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>}
   */
  async exists(filePath) {},

  /**
   * List subdirectories in a directory
   * @param {string} dirPath - Directory to list
   * @returns {Promise<string[]>} Array of subdirectory names
   */
  async listSubdirectories(dirPath) {},

  /**
   * List files in a directory with optional filtering
   * @param {string} dirPath - Directory to list
   * @param {ListFilesOptions} [options] - Filter options
   * @returns {Promise<FileInfo[]>} Array of file info objects
   */
  async listFiles(dirPath, options) {},

  /**
   * Delete a file
   * @param {string} filePath - Path to file to delete
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {},

  /**
   * Acquire a named lock to prevent concurrent operations
   * @param {string} lockName - Name of the lock
   * @param {AcquireLockOptions} [options] - Lock options
   * @returns {Promise<LockResult>}
   */
  async acquireLock(lockName, options) {},

  /**
   * Get file or directory stats
   * @param {string} filePath - Path to stat
   * @returns {Promise<StatResult>}
   */
  async stat(filePath) {},

  /**
   * Join path segments into a single path
   * @param {...string} segments - Path segments
   * @returns {string} Joined path
   */
  joinPath(...segments) {},
};

/**
 * Type guard for MediaStorageRepository
 * @param {Object} obj - Object to check
 * @returns {boolean} True if obj implements IMediaStorageRepository
 */
export function isMediaStorageRepository(obj) {
  return obj &&
    typeof obj.ensureDir === 'function' &&
    typeof obj.exists === 'function' &&
    typeof obj.listSubdirectories === 'function' &&
    typeof obj.listFiles === 'function' &&
    typeof obj.deleteFile === 'function' &&
    typeof obj.acquireLock === 'function' &&
    typeof obj.stat === 'function' &&
    typeof obj.joinPath === 'function';
}
