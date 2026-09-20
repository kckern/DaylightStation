const operations = { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported', findOwned: 'unsupported' };
const failed = (error) => ({ kind: 'failed', reason: error?.name === 'AbortError' ? 'cancelled' : /timeout|ETIMEDOUT/i.test(String(error?.code || error?.message)) ? 'timeout' : 'provider' });

/** Translation for remote HLS/embed sources with no server-side resource control. */
export class RemotePlaybackSource {
  #provider;
  #revisions = new Map();
  #opened = new Map();

  constructor({ provider } = {}) { this.#provider = provider || {}; }

  async describe({ contentId, client, tracks, signal, deadline } = {}) {
    try {
      const described = await this.#provider.describe?.({ contentId, client, tracks, signal, deadline });
      if (!described?.url) return { kind: 'unavailable', reason: described?.reason || 'absent' };
      const revision = described.revision || `remote:${contentId}`;
      this.#revisions.set(contentId, revision);
      return { kind: 'available', sourceRevision: revision, candidates: described.candidates || [], operations };
    } catch (error) { return failed(error); }
  }

  async openDefault(request) { return this.open({ ...request, renditionId: 'original' }); }

  async open({ contentId, renditionId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline } = {}) {
    if (this.#opened.has(attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    if (sourceRevision != null && this.#revisions.has(contentId) && this.#revisions.get(contentId) !== sourceRevision) {
      return { kind: 'failed', reason: 'source-revision-mismatch' };
    }
    try {
      const result = await this.#provider.open?.({ contentId, renditionId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline });
      if (!result?.url) return { kind: 'failed', reason: result?.reason || 'absent' };
      const opened = {
        kind: 'opened', handle: result.handle || `remote:${attemptId}`,
        delivery: { format: result.format || 'remote', url: result.url, contentOriginMs: positionMs || 0, seekWindow: result.seekWindow || null, expiresAt: result.expiresAt || null, segmentDurationMs: result.segmentDurationMs || null },
        actualRendition: result.actualRendition || null, conversion: result.conversion || null,
      };
      this.#opened.set(attemptId, opened.handle);
      return opened;
    } catch (error) { return failed(error); }
  }

  async inspect() { return { kind: 'unsupported' }; }
  async renew() { return { kind: 'unsupported' }; }
  async close({ attemptId } = {}) { this.#opened.delete(attemptId); return { kind: 'unsupported' }; }
  async findOwned() { return { kind: 'unsupported' }; }
}

export default RemotePlaybackSource;
