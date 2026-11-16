/** Registered sources implement identity and list reads. Playback and sibling methods are optional capabilities and must only exist when supported. A source may opt in to getList(ref, context) with acceptsListContext === true; otherwise only ref is passed. A source may implement describeParticipantAction(item, action), returning null or {participantConsumer:{id,version}} for that exact item and action. */
export class IContentSource {
  get source() { throw new Error('IContentSource.source not implemented'); }
  get prefixes() { throw new Error('IContentSource.prefixes not implemented'); }
  async getItem(_id) { throw new Error('IContentSource.getItem not implemented'); }
  async getList(_id) { throw new Error('IContentSource.getList not implemented'); }
  /**
   * Optional: `{ items, total }` for one `{ skip, take }` window of a
   * container, or null when this container cannot be paged at the source.
   */
  async getListPage(_id, _page) { return null; }
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
}

export function validateAdapter(adapter) {
  if (!adapter?.source || typeof adapter.source !== 'string') throw new Error('Adapter must have source property (string)');
  if (!Array.isArray(adapter.prefixes)) throw new Error('Adapter must have prefixes array');
  for (const method of ['getItem', 'getList']) {
    if (typeof adapter[method] !== 'function') throw new Error(`Adapter must implement ${method}`);
  }
}

export default IContentSource;
