// backend/src/3_applications/content/ports/IRemoteProgressProvider.mjs

/**
 * Port interface for remote progress synchronization.
 * Abstracts reading/writing playback progress from an external media server.
 * @class IRemoteProgressProvider
 */
export class IRemoteProgressProvider {
  /**
   * Get user progress for an item from the remote server.
   * @param {string} localId - Server-native item ID
   * @returns {Promise<{ currentTime: number, isFinished: boolean, lastUpdate: number, duration: number }|null>}
   */
  async getProgress(localId) {
    throw new Error('IRemoteProgressProvider.getProgress must be implemented');
  }

  /**
   * Update user progress for an item on the remote server.
   * @param {string} localId - Server-native item ID
   * @param {{ currentTime?: number, isFinished?: boolean }} progress
   * @returns {Promise<void>}
   */
  async updateProgress(localId, progress) {
    throw new Error('IRemoteProgressProvider.updateProgress must be implemented');
  }
}

/**
 * Validates that an object implements the IRemoteProgressProvider interface
 * @param {any} provider
 * @throws {Error} If validation fails
 */
export function validateRemoteProgressProvider(provider) {
  if (typeof provider.getProgress !== 'function') {
    throw new Error('RemoteProgressProvider must implement getProgress(localId): Promise<Object|null>');
  }
  if (typeof provider.updateProgress !== 'function') {
    throw new Error('RemoteProgressProvider must implement updateProgress(localId, progress): Promise<void>');
  }
}

export default IRemoteProgressProvider;
