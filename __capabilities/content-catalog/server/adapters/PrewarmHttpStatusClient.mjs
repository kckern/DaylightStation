import { HttpClient } from '#system/services/HttpClient.mjs';

/** Status-only HTTP adapter used by transcode prewarming. */
export class PrewarmHttpStatusClient {
  constructor({ baseUrl, logger = console, timeout = 10_000, httpClient = null } = {}) {
    this.baseUrl = baseUrl;
    this.logger = logger;
    this.httpClient = httpClient ?? new HttpClient({ logger, timeout });
  }

  async get(url) {
    try {
      const response = await this.httpClient.requestRaw('GET', `${this.baseUrl}${url}`, { responseType: 'text' });
      return { status: response.status };
    } catch (error) {
      this.logger.debug?.('prewarm.httpClient.error', { url, error: error.message });
      return { status: 0 };
    }
  }
}
