import { ICatalogListSource } from '#apps/catalog/ports/ICatalogListSource.mjs';

export class HttpCatalogListSource extends ICatalogListSource {
  #baseUrl; #fetch;
  constructor({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
    super();
    if (!baseUrl) throw new Error('HttpCatalogListSource requires baseUrl');
    if (typeof fetchImpl !== 'function') throw new Error('HttpCatalogListSource requires fetchImpl');
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }
  async getList(source, id) {
    const response = await this.#fetch(`${this.#baseUrl}/api/v1/list/${source}/${id}`);
    if (!response.ok) {
      const error = new Error('Catalog list source rejected the request');
      error.code = 'catalog_list_source_rejected';
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    return { title: data.title || 'Catalog', items: data.items || [] };
  }
}
