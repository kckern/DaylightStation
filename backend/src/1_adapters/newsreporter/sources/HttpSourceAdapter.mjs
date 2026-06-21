import { ISource } from '#apps/newsreporter/ports/ISource.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * HTTP source adapter (1_adapters).
 *
 * Fetches raw items for a report over HTTP GET. The service resolves
 * placeholders in the source config before calling gather(), so this adapter
 * treats ctx.config.url as already-final.
 *
 * "No data" (empty/null payload) yields `{ items: [] }` — NOT an error. Only a
 * genuine transport/status failure throws (wrapped as InfrastructureError).
 *
 * @implements {import('#apps/newsreporter/ports/ISource.mjs').ISource}
 */
export class HttpSourceAdapter extends ISource {
  #httpClient;
  #logger;

  /**
   * @param {{ httpClient: import('#system/services/IHttpClient.mjs').IHttpClient, logger?: object }} deps
   */
  constructor({ httpClient, logger } = {}) {
    super();
    if (!httpClient) throw new Error('HttpSourceAdapter requires an httpClient');
    this.#httpClient = httpClient;
    this.#logger = logger || console;
  }

  /**
   * @param {object} ctx run context; `ctx.config` is the resolved source block
   * @returns {Promise<{ items: Array, meta: { sourceId: string, type: 'http', fetchedAt: string } }>}
   */
  async gather(ctx = {}) {
    const cfg = ctx.config || {};
    const sourceId = cfg.id;

    let response;
    try {
      response = await this.#httpClient.get(cfg.url);
    } catch (err) {
      throw new InfrastructureError(`http source fetch failed: ${err.message}`, {
        code: 'NEWSREPORTER_HTTP_SOURCE_FAILED',
        sourceId,
        url: cfg.url,
        cause: err.message,
      });
    }

    // The project HttpClient throws on non-2xx, but guard explicitly in case a
    // client returns a response object instead of throwing.
    const ok = response?.ok ?? (response?.status >= 200 && response?.status < 300);
    if (!ok) {
      throw new InfrastructureError(`http source fetch failed: status ${response?.status}`, {
        code: 'NEWSREPORTER_HTTP_SOURCE_FAILED',
        sourceId,
        url: cfg.url,
        status: response?.status,
      });
    }

    const payload = cfg.jsonPath ? pluck(response?.data, cfg.jsonPath) : response?.data;
    const items = normaliseItems(payload);

    this.#logger.info?.('newsreporter.source.fetch', {
      sourceId,
      type: 'http',
      itemCount: items.length,
    });

    return {
      items,
      meta: { sourceId, type: 'http', fetchedAt: new Date().toISOString() },
    };
  }
}

/**
 * Normalise an arbitrary payload into an items array.
 * Empty/null → []; array → itself; any other value → single-item array.
 * @param {unknown} payload
 * @returns {Array}
 */
function normaliseItems(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  return [payload];
}

/**
 * Minimal `$.a.b` dot-path pluck. Returns undefined when the path misses.
 * @param {unknown} obj
 * @param {string} path e.g. '$.response.matches'
 * @returns {unknown}
 */
function pluck(obj, path) {
  const segments = String(path).replace(/^\$\.?/, '').split('.').filter(Boolean);
  let current = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    current = current[seg];
  }
  return current;
}
