import { IStreamResolver } from '#apps/content/ports/IStreamResolver.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';

export class ScrapeStreamResolver extends IStreamResolver {
  #fetch; #logger;
  constructor({ fetchFn = fetch, logger = console } = {}) {
    super();
    this.#fetch = fetchFn;
    this.#logger = logger;
  }
  get strategy() { return 'scrape'; }

  async resolve(url, profile) {
    const cfg = profile?.raw?.scrape || {};
    const headers = cfg.headers || {};
    let html;
    try {
      const res = await this.#fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', ...headers } });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      this.#logger.warn?.('stream.scrape.fetch_failed', { url, error: e.message });
      return null;
    }
    for (const pat of cfg.patterns || []) {
      const m = html.match(new RegExp(pat, 'i'));
      if (m && m[1]) {
        const mediaUrl = new URL(m[1], url).toString();
        return new StreamResult({ format: profile.format, mediaUrl, headers: cfg.headers || null });
      }
    }
    return null;
  }
}
