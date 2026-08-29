/** Application operation for safe dynamic-origin streaming. */
export class DynamicStreamService {
  #gateway;
  #logger;

  constructor({ gateway, logger = console } = {}) {
    if (!gateway || typeof gateway.open !== 'function') {
      throw new Error('DynamicStreamService requires gateway');
    }
    this.#gateway = gateway;
    this.#logger = logger;
  }

  async open({ sourceUrl, profileName, range }) {
    if (!sourceUrl || typeof sourceUrl !== 'string') return { kind: 'missing_source' };
    try {
      const result = await this.#gateway.open({ sourceUrl, profileName, range });
      if (result.kind === 'upstream_error') {
        this.#logger.warn?.('proxy.stream.upstreamStatus', {
          host: result.host,
          status: result.status,
        });
      }
      return result;
    } catch (error) {
      if (error.code === 'STREAM_BLOCKED_HOST') {
        this.#logger.warn?.('proxy.stream.blocked', {
          host: error.host,
          ...(error.via ? { via: error.via } : {}),
        });
        return { kind: 'blocked' };
      }
      if (error.code === 'STREAM_INVALID_URL') {
        if (error.via) {
          this.#logger.warn?.('proxy.stream.blocked', { host: error.host, via: error.via });
        }
        return { kind: 'invalid', message: error.message };
      }
      if (error.code === 'STREAM_TOO_MANY_REDIRECTS') {
        this.#logger.warn?.('proxy.stream.tooManyRedirects', { host: error.host });
        return { kind: 'too_many_redirects' };
      }
      this.#logger.warn?.('proxy.stream.fetchFailed', {
        host: error.host,
        error: error.message,
      });
      return { kind: 'fetch_failed' };
    }
  }
}

export default DynamicStreamService;
