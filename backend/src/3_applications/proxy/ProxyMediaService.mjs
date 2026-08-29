const LOCAL_CONTENT_TYPES = new Set(['talk', 'scripture', 'hymn', 'primary', 'poem']);

/** Application operations for resolving proxy-served local media. */
export class ProxyMediaService {
  #repository;

  constructor({ repository } = {}) {
    if (!repository
      || typeof repository.findContentMedia !== 'function'
      || typeof repository.findLocalContentMedia !== 'function'
      || typeof repository.findMediaTreeResource !== 'function') {
      throw new Error('ProxyMediaService requires repository');
    }
    this.#repository = repository;
  }

  async getContentMedia(mediaRef) {
    return this.#repository.findContentMedia(mediaRef);
  }

  async getLocalContentMedia({ type, mediaRef }) {
    if (!LOCAL_CONTENT_TYPES.has(type)) return { kind: 'invalid_type', type };
    return this.#repository.findLocalContentMedia(type, mediaRef);
  }

  async getMediaTreeResource(mediaRef) {
    if (!mediaRef) return { kind: 'missing_path' };
    return this.#repository.findMediaTreeResource(mediaRef);
  }
}

export default ProxyMediaService;
