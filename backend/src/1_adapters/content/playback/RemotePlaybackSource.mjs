import { validateRendition } from '#domains/content/playback/contracts.mjs';

const operations = { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported', findOwned: 'unsupported' };
const failed = (error) => ({ kind: 'failed', reason: error?.name === 'AbortError' || error?.code === 'ABORTED' ? 'cancelled' : /timeout|ETIMEDOUT/i.test(String(error?.code || error?.message)) ? 'timeout' : 'provider' });
const conversion = value => ['none', 'remux', 'audio', 'video', 'unknown'].includes(value) ? value : 'unknown';
const normalizedRendition = value => { try { return validateRendition(value); } catch { return null; } };
function delivery(value, positionMs) {
  if (typeof value?.url !== 'string' || !/^https?:\/\//.test(value.url)) return null;
  const seekWindow = Number.isFinite(value.seekWindow?.startMs) && Number.isFinite(value.seekWindow?.endMs)
    ? { startMs: value.seekWindow.startMs, endMs: value.seekWindow.endMs } : null;
  return { format: typeof value.format === 'string' && value.format ? value.format : 'remote', url: value.url, contentOriginMs: Number.isFinite(value.contentOriginMs) ? value.contentOriginMs : Number(positionMs) || 0, seekWindow, expiresAt: Number.isFinite(value.expiresAt) ? value.expiresAt : null, segmentDurationMs: Number.isFinite(value.segmentDurationMs) ? value.segmentDurationMs : null };
}

/** Translation for remote HLS/embed sources with no server-side resource control. */
export class RemotePlaybackSource {
  #provider;
  #revisions = new Map();
  #opened = new Map();
  #opening = new Map();

  constructor({ provider } = {}) { this.#provider = provider || {}; }

  async describe({ contentId, client, tracks, signal, deadline } = {}) {
    try {
      const described = await this.#provider.describe?.({ contentId, client, tracks, signal, deadline });
      if (!described?.url) return { kind: 'unavailable', reason: described?.reason || 'absent' };
      const revision = described.revision || `remote:${contentId}`;
      this.#revisions.set(contentId, revision);
      return { kind: 'available', sourceRevision: revision, candidates: (described.candidates || []).map(normalizedRendition).filter(Boolean), operations };
    } catch (error) { return failed(error); }
  }

  async openDefault(request) { return this.open({ ...request, renditionId: 'original' }); }

  async open({ attemptId, ...request } = {}) {
    if (this.#opened.has(attemptId) || this.#opening.has(attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    const opening = this.#open({ attemptId, ...request });
    this.#opening.set(attemptId, opening);
    try { return await opening; } finally { this.#opening.delete(attemptId); }
  }

  async #open({ contentId, renditionId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline } = {}) {
    if (sourceRevision != null && this.#revisions.has(contentId) && this.#revisions.get(contentId) !== sourceRevision) {
      return { kind: 'failed', reason: 'source-revision-mismatch' };
    }
    try {
      const result = await this.#provider.open?.({ contentId, renditionId, sourceRevision, attemptId, generation, positionMs, tracks, client, signal, deadline });
      const normalizedDelivery = delivery(result, positionMs);
      if (!normalizedDelivery) return { kind: 'failed', reason: result?.reason || 'absent' };
      const actualRendition = normalizedRendition(result.actualRendition);
      const opened = {
        kind: 'opened', handle: `remote:${attemptId}`, delivery: normalizedDelivery,
        actualRendition, conversion: actualRendition?.conversion || conversion(result.conversion),
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
