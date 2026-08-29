import { ICompositeImageSource } from '#apps/proxy/ports/ICompositeImageSource.mjs';

/** Remote source for the cover/current/next images in one composite hero. */
export class KomgaCompositeImageSource extends ICompositeImageSource {
  #adapter;
  #fetch;

  constructor({ adapter = null, fetchFn = globalThis.fetch } = {}) {
    super();
    this.#adapter = adapter;
    this.#fetch = fetchFn;
  }

  async loadImages(id, page) {
    if (!this.#adapter?.isConfigured?.()) return { kind: 'unconfigured' };
    const baseUrl = this.#adapter.getBaseUrl();
    const authHeaders = this.#adapter.getAuthHeaders();
    const urls = [
      `${baseUrl}/api/v1/books/${id}/thumbnail`,
      `${baseUrl}/api/v1/books/${id}/pages/${page}`,
      `${baseUrl}/api/v1/books/${id}/pages/${page + 1}`,
    ];
    const settled = await Promise.allSettled(urls.map(async (url) => {
      const response = await this.#fetch(url, {
        headers: { ...authHeaders, Accept: 'image/jpeg' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }));
    return {
      kind: 'loaded',
      buffers: settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value),
    };
  }
}

export default KomgaCompositeImageSource;
