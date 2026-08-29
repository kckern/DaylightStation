/** Application-facing contract for a registered content source. */
export class IContentSource {
  get source() { throw new Error('IContentSource.source not implemented'); }
  get prefixes() { throw new Error('IContentSource.prefixes not implemented'); }
  async getItem(_id) { throw new Error('IContentSource.getItem not implemented'); }
  async getList(_id) { throw new Error('IContentSource.getList not implemented'); }
  async resolvePlayables(_id) { throw new Error('IContentSource.resolvePlayables not implemented'); }
  async resolveSiblings(_compoundId) { throw new Error('IContentSource.resolveSiblings not implemented'); }
}

/** Base class retained for concrete adapter implementations. */
export class ContentSourceBase extends IContentSource {
  constructor() {
    super();
    if (new.target === ContentSourceBase) throw new Error('ContentSourceBase is abstract');
  }

  get source() { throw new Error('source must be implemented'); }
  get prefixes() { throw new Error('prefixes must be implemented'); }
  async getItem(_id) { throw new Error('getItem must be implemented'); }
  async getList(_id) { throw new Error('getList must be implemented'); }
  async resolvePlayables(_id) { throw new Error('resolvePlayables must be implemented'); }
  async resolveSiblings(_compoundId) { throw new Error('resolveSiblings must be implemented'); }
}

export function validateAdapter(adapter) {
  if (!adapter?.source || typeof adapter.source !== 'string') throw new Error('Adapter must have source property (string)');
  if (!Array.isArray(adapter.prefixes)) throw new Error('Adapter must have prefixes array');
  for (const method of ['getItem', 'getList', 'resolvePlayables', 'resolveSiblings']) {
    if (typeof adapter[method] !== 'function') throw new Error(`Adapter must implement ${method}`);
  }
}

export default IContentSource;
