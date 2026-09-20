import { IPlaybackSourceGateway, assertPlaybackSourceGateway } from '#apps/content/ports/IPlaybackSourceGateway.mjs';

const unsupported = { kind: 'unsupported' };

/** Routes opaque catalog source references to their provider translation. */
export class RegistryPlaybackSourceGateway extends IPlaybackSourceGateway {
  #catalog;
  #sources;
  #owned = new Map();
  #opening = new Map();

  constructor({ catalog, sources = {} } = {}) {
    super();
    if (!catalog || typeof catalog.playbackSourceReference !== 'function') {
      throw new Error('RegistryPlaybackSourceGateway requires catalog.playbackSourceReference()');
    }
    this.#catalog = catalog;
    this.#sources = sources instanceof Map ? sources : new Map(Object.entries(sources));
    assertPlaybackSourceGateway(this);
  }

  #resolved(contentId) {
    const reference = this.#catalog.playbackSourceReference(contentId);
    if (!reference?.source || reference.localId == null) return null;
    const source = this.#sources.get(reference.source);
    return source ? { source, contentId: String(reference.localId) } : null;
  }

  async #call(contentId, method, request) {
    const resolved = this.#resolved(contentId);
    if (!resolved) return unsupported;
    if (typeof resolved.source[method] !== 'function') return unsupported;
    return resolved.source[method]({ ...request, contentId: resolved.contentId });
  }

  async describe(request) { return this.#call(request.contentId, 'describe', request); }

  async openDefault(request) {
    if (this.#owned.has(request.attemptId) || this.#opening.has(request.attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    const opening = this.#call(request.contentId, 'openDefault', request);
    this.#opening.set(request.attemptId, opening);
    try {
      const result = await opening;
      if (result?.kind === 'opened') this.#owned.set(request.attemptId, { contentId: request.contentId, handle: result.handle });
      return result;
    } finally {
      this.#opening.delete(request.attemptId);
    }
  }

  async open(request) {
    if (this.#owned.has(request.attemptId) || this.#opening.has(request.attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    const opening = this.#call(request.contentId, 'open', request);
    this.#opening.set(request.attemptId, opening);
    try {
      const result = await opening;
      if (result?.kind === 'opened') this.#owned.set(request.attemptId, { contentId: request.contentId, handle: result.handle });
      return result;
    } finally {
      this.#opening.delete(request.attemptId);
    }
  }

  async inspect({ attemptId, handle, ...request }) {
    const owned = this.#owned.get(attemptId);
    if (!owned) return { kind: 'unknown' };
    return this.#call(owned.contentId, 'inspect', { ...request, attemptId, handle });
  }

  async renew({ attemptId, handle, ...request }) {
    const owned = this.#owned.get(attemptId);
    if (!owned) return { kind: 'failed', reason: 'absent' };
    return this.#call(owned.contentId, 'renew', { ...request, attemptId, handle });
  }

  async close({ attemptId, handle, ...request }) {
    const owned = this.#owned.get(attemptId);
    if (!owned) return { kind: 'unsupported' };
    const result = await this.#call(owned.contentId, 'close', { ...request, attemptId, handle });
    if (result?.kind === 'closed') this.#owned.delete(attemptId);
    return result;
  }

  async findOwned({ attemptId, ...request }) {
    const owned = this.#owned.get(attemptId);
    if (owned) return { kind: 'found', handle: owned.handle };
    return { kind: 'absent' };
  }
}

export default RegistryPlaybackSourceGateway;
