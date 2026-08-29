/** Resolves configured EInk data sources and optional image references. */
import { IEinkDataSourceGateway } from '#apps/eink/ports/IEinkDataSourceGateway.mjs';

export class HttpEinkDataSourceGateway extends IEinkDataSourceGateway {
  #baseUrl;
  #fetch;
  #decodeImage;
  constructor({ baseUrl, fetchImpl = globalThis.fetch, decodeImage }) {
    super();
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#decodeImage = decodeImage;
  }
  async resolve(sources, { loadImages = false, logger, scopeKey = null } = {}) {
    if (!sources || typeof sources !== 'object') return {};
    const entries = Object.entries(sources).map(([key, config]) => {
      if (!scopeKey || !config || typeof config.source !== 'string') return [key, config];
      const separator = config.source.includes('?') ? '&' : '?';
      return [key, { ...config, source: `${config.source}${separator}hold_key=${encodeURIComponent(scopeKey)}` }];
    });
    const results = await Promise.allSettled(entries.map(async ([key, config]) => {
      const absolute = config.source.startsWith('http');
      if (!absolute && !this.#baseUrl) throw new Error(`relative data source "${config.source}" needs a baseUrl (unset household daylightHost)`);
      const url = absolute ? config.source : `${this.#baseUrl}${config.source}`;
      if (typeof this.#fetch !== 'function') throw new Error('EInk data source gateway requires fetch');
      const response = await this.#fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      if (loadImages && config.image && json && typeof json === 'object') {
        const reference = json[config.image];
        if (reference) {
          try {
            const imageUrl = String(reference).startsWith('http') ? reference : `${this.#baseUrl}${reference}`;
            const imageResponse = await this.#fetch(imageUrl);
            const image = imageResponse.ok && this.#decodeImage
              ? await this.#decodeImage(Buffer.from(await imageResponse.arrayBuffer()))
              : null;
            if (image) json.imageEl = image;
          } catch { /* preserve caption-only degradation */ }
        }
      }
      return [key, json];
    }));
    const data = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') data[result.value[0]] = result.value[1];
      else logger?.warn?.('eink.data.source_rejected', {
        key: entries[index][0], source: entries[index][1]?.source,
        error: result.reason?.message || String(result.reason),
      });
    });
    return data;
  }
}

export default HttpEinkDataSourceGateway;
