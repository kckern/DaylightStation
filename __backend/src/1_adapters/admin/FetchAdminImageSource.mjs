import { IAdminImageSource } from '#apps/admin/ports/IAdminImageSource.mjs';

export class FetchAdminImageSource extends IAdminImageSource {
  #fetch;
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    super();
    if (typeof fetchImpl !== 'function') throw new Error('FetchAdminImageSource requires fetchImpl');
    this.#fetch = fetchImpl;
  }
  async download(url) {
    const response = await this.#fetch(url);
    const result = {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      buffer: null,
    };
    if (!response.ok) return result;
    return {
      ...result,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }
}
