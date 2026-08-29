import { IRemoteThumbnailSource } from '#apps/proxy/ports/IRemoteThumbnailSource.mjs';

/** HTTP source for RetroArch thumbnails exposed by a remote file manager. */
export class XploreThumbnailSource extends IRemoteThumbnailSource {
  #baseUrl;
  #thumbnailsPath;
  #fetch;

  constructor({ baseUrl, thumbnailsPath, fetchFn = globalThis.fetch } = {}) {
    super();
    if (!baseUrl || !thumbnailsPath) throw new Error('XploreThumbnailSource requires configuration');
    this.#baseUrl = baseUrl;
    this.#thumbnailsPath = thumbnailsPath;
    this.#fetch = fetchFn;
  }

  async fetchThumbnail(thumbnailId) {
    const response = await this.#fetch(
      `${this.#baseUrl}${this.#thumbnailsPath}/${thumbnailId}?cmd=file`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error(`xplore HTTP ${response.status}`);
    return {
      contentType: response.headers.get('content-type') || 'image/png',
      artifact: Buffer.from(await response.arrayBuffer()),
    };
  }
}

export default XploreThumbnailSource;
