/**
 * ISharedVideoSource — where a video shared from the phone can be fetched from.
 *
 * The use case never knows which service a link belongs to: each source
 * adapter recognises its own links and fetches its own videos. Only the
 * adapter names its service, as `provider`, which the screen's scene uses to
 * pick a logo from config.
 *
 * A fetched video is handed back as an opaque media resource
 * (`{ size, mimeType, open({ start, end }) -> Readable }`), so where the file
 * lives (a fetch service, temp storage) stays the adapter's business.
 *
 * Reference: __docs/reference/core/share.md
 */
export class ISharedVideoSource {
  /**
   * The video a shared link names, or null when the link is not this source's.
   * @param {string} url - A URL found in shared text (untrusted)
   * @returns {{ provider: string, sourceId: string }|null}
   */
  // eslint-disable-next-line no-unused-vars
  recognize(url) { throw new Error('ISharedVideoSource.recognize must be implemented'); }

  /**
   * Fetch the video under `name` (the share job id), reporting real progress.
   * @param {string} sourceId - As `recognize` returned it
   * @param {{ name: string, maxHeight?: number, onProgress?: (fraction: number) => void, onAttempt?: (attempt: { fetcher: string, n: number }) => void }} options
   * @returns {Promise<{ kind: 'downloaded', title: string|null, duration: number|null, media: object }
   *   | { kind: 'failed', error: string, reason?: 'unavailable'|'too_large'|'stalled'|'cancelled'|'error' }>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetch(sourceId, options) { throw new Error('ISharedVideoSource.fetch must be implemented'); }

  /**
   * A video this source already holds under `name` (fetched before a restart of
   * the app), or null.
   * @returns {Promise<{ provider: string, title: string|null, duration: number|null, media: object }|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async stored(name) { return null; }

  /** Stop a fetch under `name` and drop what it holds. */
  // eslint-disable-next-line no-unused-vars
  async cancel(name) { /* nothing to cancel */ }

  /**
   * The content id that streams the same video when it cannot be fetched (the
   * last fallback), or null when the source has none.
   */
  // eslint-disable-next-line no-unused-vars
  streamContentId(sourceId) { return null; }
}

export function isSharedVideoSource(obj) {
  return !!obj && typeof obj.recognize === 'function' && typeof obj.fetch === 'function';
}

export default ISharedVideoSource;
