/**
 * @interface IEditionStore
 *
 * Holds an edition reporter's editions: one record per reporter per calendar
 * day (the composed layout, its inputs, its deliveries) and the day's PNG.
 * Implementations live in 1_adapters (YamlEditionDatastore). A save replaces
 * the day's record; there is one edition per day.
 */
export class IEditionStore {
  /** @returns {Promise<object|null>} the record for that day, or null */
  async get(reporterId, date) { throw new Error('IEditionStore.get must be implemented'); }

  /** @returns {Promise<void>} */
  async save(reporterId, date, record) { throw new Error('IEditionStore.save must be implemented'); }

  /**
   * @param {string} reporterId
   * @param {{ limit?: number, before?: string }} [opts] - `before`: only days strictly before this date
   * @returns {Promise<object[]>} records, newest first, each with its `date`
   */
  async list(reporterId, opts = {}) { throw new Error('IEditionStore.list must be implemented'); }

  /** @returns {Promise<void>} */
  async savePng(reporterId, date, buffer) { throw new Error('IEditionStore.savePng must be implemented'); }

  /** @returns {Promise<Buffer|null>} */
  async readPng(reporterId, date) { throw new Error('IEditionStore.readPng must be implemented'); }

  /**
   * The stored PNG as a filesystem path, which is what the thermal printer's
   * image item reads. Null when the day has no image.
   * @returns {Promise<string|null>}
   */
  async pngPath(reporterId, date) { throw new Error('IEditionStore.pngPath must be implemented'); }
}

export function isEditionStore(obj) {
  return !!obj && ['get', 'save', 'list', 'savePng', 'readPng', 'pngPath'].every((m) => typeof obj[m] === 'function');
}

export default IEditionStore;
