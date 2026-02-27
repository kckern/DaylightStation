import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

/**
 * MediaQueueService - Application-layer orchestrator for media queue operations.
 *
 * Each method follows the pattern: load from store -> mutate entity -> save to store -> log -> return.
 * All persistence is delegated to the injected queueStore (IMediaQueueDatastore).
 */
export class MediaQueueService {
  #queueStore;
  #defaultHouseholdId;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/media/ports/IMediaQueueDatastore.mjs').IMediaQueueDatastore} deps.queueStore
   * @param {string} deps.defaultHouseholdId
   * @param {Object} [deps.logger=console]
   */
  constructor({ queueStore, defaultHouseholdId, logger = console }) {
    if (!queueStore) {
      throw new Error('MediaQueueService requires queueStore');
    }
    this.#queueStore = queueStore;
    this.#defaultHouseholdId = defaultHouseholdId;
    this.#logger = logger;
  }

  /**
   * Resolve the effective household ID.
   * @param {string} [householdId]
   * @returns {string}
   */
  #hid(householdId) {
    return householdId || this.#defaultHouseholdId;
  }

  /**
   * Load the media queue for a household.
   * Returns MediaQueue.empty() if store has nothing.
   *
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async load(householdId) {
    const hid = this.#hid(householdId);
    const stored = await this.#queueStore.load(hid);
    const queue = stored || MediaQueue.empty();
    this.#logger?.info?.('media-queue.loaded', { householdId: hid, length: queue.length });
    return queue;
  }

  /**
   * Replace the entire queue with a provided one.
   *
   * @param {MediaQueue} queue
   * @param {string} [householdId]
   * @returns {Promise<void>}
   */
  async replace(queue, householdId) {
    const hid = this.#hid(householdId);
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.saved', { householdId: hid, length: queue.length });
  }

  /**
   * Add items to the queue.
   *
   * @param {Array<Object>} items
   * @param {'end'|'next'} [placement='end']
   * @param {string} [householdId]
   * @returns {Promise<Array<Object>>} The stamped items that were added.
   */
  async addItems(items, placement = 'end', householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    const added = queue.addItems(items, placement);
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.items-added', { householdId: hid, count: added.length, placement });
    return added;
  }

  /**
   * Remove an item from the queue by queueId.
   *
   * @param {string} queueId
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async removeItem(queueId, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    queue.removeByQueueId(queueId);
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.item-removed', { householdId: hid, queueId });
    return queue;
  }

  /**
   * Reorder an item within the queue.
   *
   * @param {string} queueId
   * @param {number} toIndex
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async reorder(queueId, toIndex, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    queue.reorder(queueId, toIndex);
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.reordered', { householdId: hid, queueId, toIndex });
    return queue;
  }

  /**
   * Set the playback position.
   *
   * @param {number} position
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async setPosition(position, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    queue.position = position;
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.position-changed', { householdId: hid, position });
    return queue;
  }

  /**
   * Update queue state (shuffle, repeat, volume).
   *
   * @param {Object} state - Object with optional keys: shuffle, repeat, volume
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async updateState(state, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);

    if ('shuffle' in state) {
      queue.setShuffle(state.shuffle);
    }
    if ('repeat' in state) {
      queue.repeat = state.repeat;
    }
    if ('volume' in state) {
      queue.volume = state.volume;
    }

    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.state-updated', { householdId: hid, state });
    return queue;
  }

  /**
   * Clear the queue.
   *
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async clear(householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    queue.clear();
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.cleared', { householdId: hid });
    return queue;
  }

  /**
   * Advance the playback position.
   *
   * @param {number} [step=1]
   * @param {Object} [options]
   * @param {boolean} [options.auto=false]
   * @param {string} [householdId]
   * @returns {Promise<MediaQueue>}
   */
  async advance(step = 1, { auto = false } = {}, householdId) {
    const hid = this.#hid(householdId);
    const queue = await this.load(hid);
    queue.advance(step, { auto });
    await this.#queueStore.save(queue, hid);
    this.#logger?.info?.('media-queue.advanced', { householdId: hid, step, auto });
    return queue;
  }
}

export default MediaQueueService;
