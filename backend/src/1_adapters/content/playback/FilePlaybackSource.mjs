import { validateRendition } from '#domains/content/playback/contracts.mjs';

const failed = (error) => ({ kind: 'failed', reason: error?.name === 'AbortError' || error?.code === 'ABORTED' ? 'cancelled' : /timeout|ETIMEDOUT/i.test(String(error?.code || error?.message)) ? 'timeout' : 'provider' });
const operations = { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported', findOwned: 'supported' };
const conversion = value => ['none', 'remux', 'audio', 'video', 'unknown'].includes(value) ? value : 'unknown';
const normalizedRendition = value => { try { return validateRendition(value); } catch { return null; } };
function delivery(value, positionMs) {
  if (typeof value?.url !== 'string' || !(/^\/api\//.test(value.url) || /^https?:\/\//.test(value.url))) return null;
  return { format: typeof value.format === 'string' && value.format ? value.format : 'file', url: value.url, contentOriginMs: Number.isFinite(value.contentOriginMs) ? value.contentOriginMs : Number(positionMs) || 0, seekWindow: null, expiresAt: Number.isFinite(value.expiresAt) ? value.expiresAt : null, segmentDurationMs: Number.isFinite(value.segmentDurationMs) ? value.segmentDurationMs : null };
}

/** Translation for local/file providers. Provider references are never returned. */
export class FilePlaybackSource {
  #provider;
  #opened = new Map();
  #opening = new Map();
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
        candidates: (described.candidates || []).map(normalizedRendition).filter(Boolean), operations,
      };
    } catch (error) { return failed(error); }
  }

  async openDefault(request) { return this.open({ ...request, renditionId: 'original' }); }

  async open({ attemptId, ...request } = {}) {
    if (this.#opened.has(attemptId) || this.#opening.has(attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    const opening = this.#open({ attemptId, ...request });
    this.#opening.set(attemptId, opening);
    try { return await opening; } finally { this.#opening.delete(attemptId); }
  }

  async #open({ contentId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline } = {}) {
    if (sourceRevision != null && this.#revisions.has(contentId) && this.#revisions.get(contentId) !== sourceRevision) {
      return { kind: 'failed', reason: 'source-revision-mismatch' };
    }
    try {
      const result = await this.#provider.open?.({ contentId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline });
      const normalizedDelivery = delivery(result, positionMs);
      if (!normalizedDelivery) return { kind: 'failed', reason: result?.reason || 'absent' };
      const actualRendition = normalizedRendition(result.actualRendition);
      const opened = {
        kind: 'opened', handle: `file:${attemptId}`, delivery: normalizedDelivery,
        actualRendition, conversion: actualRendition?.conversion || conversion(result.conversion),
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
