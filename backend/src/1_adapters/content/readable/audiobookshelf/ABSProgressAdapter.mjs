// backend/src/1_adapters/content/readable/audiobookshelf/ABSProgressAdapter.mjs

import { IRemoteProgressProvider } from '#apps/content/ports/IRemoteProgressProvider.mjs';

/**
 * Audiobookshelf implementation of IRemoteProgressProvider.
 * Wraps AudiobookshelfClient for progress read/write operations.
 */
export class ABSProgressAdapter extends IRemoteProgressProvider {
  #client;

  /**
   * @param {import('./AudiobookshelfClient.mjs').AudiobookshelfClient} client
   */
  constructor(client) {
    super();
    this.#client = client;
  }

  async getProgress(localId) {
    return this.#client.getProgress(localId);
  }

  async updateProgress(localId, progress) {
    return this.#client.updateProgress(localId, progress);
  }
}

export default ABSProgressAdapter;
