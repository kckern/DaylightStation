const failed = (error) => ({ kind: 'failed', reason: error?.name === 'AbortError' ? 'cancelled' : /timeout|ETIMEDOUT/i.test(String(error?.code || error?.message)) ? 'timeout' : 'provider' });
const operations = { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported', findOwned: 'unsupported' };

/** Translation for local/file providers. Provider references are never returned. */
export class FilePlaybackSource {
  #provider;
  #opened = new Map();
  #revisions = new Map();

  constructor({ provider } = {}) { this.#provider = provider || {}; }

  async describe({ contentId, client, tracks, signal, deadline } = {}) {
    try {
      const described = await this.#provider.describe?.({ contentId, client, tracks, signal, deadline });
      if (!described) return { kind: 'unavailable', reason: 'absent' };
      const revision = described.revision || `file:${contentId}`;
      this.#revisions.set(contentId, revision);
      return {
        kind: 'available', sourceRevision: revision,
        candidates: described.candidates || [], operations,
      };
    } catch (error) { return failed(error); }
  }

  async openDefault(request) { return this.open({ ...request, renditionId: 'original' }); }

  async open({ contentId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline } = {}) {
    if (this.#opened.has(attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    if (sourceRevision != null && this.#revisions.has(contentId) && this.#revisions.get(contentId) !== sourceRevision) {
      return { kind: 'failed', reason: 'source-revision-mismatch' };
    }
    try {
      const result = await this.#provider.open?.({ contentId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline });
      if (!result?.url) return { kind: 'failed', reason: result?.reason || 'absent' };
      const opened = {
        kind: 'opened', handle: result.handle || `file:${attemptId}`,
        delivery: { format: result.format || 'file', url: result.url, contentOriginMs: positionMs || 0, seekWindow: null, expiresAt: null, segmentDurationMs: null },
        actualRendition: result.actualRendition || null, conversion: result.conversion || null,
      };
      this.#opened.set(attemptId, opened.handle);
      return opened;
    } catch (error) { return failed(error); }
  }

  async inspect() { return { kind: 'unsupported' }; }
  async renew() { return { kind: 'unsupported' }; }
  async close({ attemptId } = {}) { return this.#opened.delete(attemptId) ? { kind: 'closed' } : { kind: 'unsupported' }; }
  async findOwned({ attemptId } = {}) { return this.#opened.has(attemptId) ? { kind: 'found', handle: this.#opened.get(attemptId) } : { kind: 'absent' }; }
}

export default FilePlaybackSource;
