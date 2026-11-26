/**
 * ISharedVideoSource — where a video shared from the phone can be fetched from.
 *
 * The use case never knows which service a link belongs to: each source
 * adapter recognises its own links and fetches its own videos. Only the
 * adapter names its service, as `provider`, which the screen's scene uses to
 * pick a logo from config.
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
   * Fetch the video to an exact mp4 path, reporting real progress.
   * @param {string} sourceId - As `recognize` returned it
   * @param {{ outputPath: string, maxHeight?: number, onProgress?: (fraction: number) => void, signal?: AbortSignal }} options
   * @returns {Promise<{ kind: 'downloaded', filePath: string, title: string|null, duration: number|null }|{ kind: 'failed', error: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetch(sourceId, options) { throw new Error('ISharedVideoSource.fetch must be implemented'); }
}

export function isSharedVideoSource(obj) {
  return !!obj && typeof obj.recognize === 'function' && typeof obj.fetch === 'function';
}

export default ISharedVideoSource;
