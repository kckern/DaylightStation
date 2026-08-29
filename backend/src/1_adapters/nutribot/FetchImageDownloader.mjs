import { IImageDownloader } from '#apps/nutribot/ports/IImageDownloader.mjs';

/** Fetch-backed image downloader. HTTP response handling intentionally mirrors
 * the former use-case code: the response body is returned regardless of status. */
export class FetchImageDownloader extends IImageDownloader {
  #fetch;

  constructor({ fetchImpl = globalThis.fetch } = {}) {
    super();
    if (typeof fetchImpl !== 'function') throw new Error('FetchImageDownloader requires fetchImpl');
    this.#fetch = fetchImpl;
  }

  async download(url) {
    const response = await this.#fetch(url);
    return Buffer.from(await response.arrayBuffer());
  }
}
