/**
 * Credential-safe client for Fully Kiosk's query-string REST API.
 *
 * Fully requires its password in the URL. This client owns URL construction so
 * neither application code nor structured logs ever receive the authenticated
 * URL. Parameter values are intentionally absent from request logs as they can
 * contain private URLs, overlay messages, or speech text.
 */
export class FullyKioskRestClient {
  #host;
  #port;
  #password;
  #httpClient;
  #logger;

  constructor({ host, port = 2323, password }, { httpClient, logger = console } = {}) {
    if (!host) throw new Error('FullyKioskRestClient requires host');
    if (!httpClient?.get) throw new Error('FullyKioskRestClient requires httpClient.get');
    this.#host = host;
    this.#port = port;
    this.#password = password || '';
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  async command(command, params = {}, { json = true, binary = false, timeout = 10_000 } = {}) {
    const query = new URLSearchParams({ command: '' });
    query.delete('command');
    query.set('cmd', command);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    if (json) query.set('type', 'json');
    query.set('password', this.#password);

    const url = `http://${this.#host}:${this.#port}/?${query}`;
    const startedAt = Date.now();
    this.#logger.debug?.('fullykiosk.rest.request', {
      command,
      host: this.#host,
      port: this.#port,
      parameterNames: Object.keys(params),
    });

    try {
      const response = await this.#httpClient.get(url, {
        timeout,
        ...(binary ? { responseType: 'arraybuffer' } : {}),
      });
      const status = response?.status ?? 200;
      if (status < 200 || status >= 300) {
        return this.#failure(
          [401, 403].includes(status) ? 'AUTH_REJECTED' : 'HTTP_ERROR',
          `HTTP ${status}`,
          { command, status, startedAt },
        );
      }

      if (binary) {
        const data = Buffer.isBuffer(response.data)
          ? response.data
          : Buffer.from(response.data || []);
        const textPrefix = data.subarray(0, 1024).toString('utf8').trimStart();
        if (textPrefix.startsWith('<')) {
          const authError = /login|password|auth/i.test(textPrefix);
          return this.#failure(
            authError ? 'AUTH_REJECTED' : 'INVALID_RESPONSE',
            authError ? 'Configured credentials were rejected' : 'Device returned an unexpected response',
            { command, startedAt },
          );
        }
        if (textPrefix.startsWith('{')) {
          try {
            const payload = JSON.parse(data.toString('utf8'));
            if (payload?.status === 'Error') {
              const authError = /login|password|auth/i.test(payload.statustext || '');
              return this.#failure(
                authError ? 'AUTH_REJECTED' : 'COMMAND_REJECTED',
                authError ? 'Configured credentials were rejected' : 'Command was rejected',
                { command, startedAt },
              );
            }
          } catch { /* Non-JSON binary continues to the caller for format validation. */ }
        }
        this.#success(command, startedAt);
        return { ok: true, data, headers: response.headers || {} };
      }

      let data = response?.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* HTML/text handled below */ }
      }
      if (data && typeof data === 'object' && data.status === 'Error') {
        const authError = /login|password|auth/i.test(data.statustext || '');
        return this.#failure(
          authError ? 'AUTH_REJECTED' : 'COMMAND_REJECTED',
          authError ? 'Configured credentials were rejected' : 'Command was rejected',
          { command, startedAt },
        );
      }
      if (typeof data === 'string' && /^\s*</.test(data)) {
        const authError = /login|password|auth/i.test(data);
        return this.#failure(
          authError ? 'AUTH_REJECTED' : 'INVALID_RESPONSE',
          authError ? 'Configured credentials were rejected' : 'Device returned an unexpected response',
          { command, startedAt },
        );
      }

      this.#success(command, startedAt);
      return { ok: true, data };
    } catch (error) {
      const message = error?.message || 'Request failed';
      const timeoutError = /abort|timeout|ETIMEDOUT|ECONNABORTED/i.test(`${error?.code || ''} ${message}`);
      return this.#failure(
        timeoutError ? 'TIMEOUT' : 'UNREACHABLE',
        message,
        { command, startedAt },
      );
    }
  }

  #success(command, startedAt) {
    this.#logger.debug?.('fullykiosk.rest.response', {
      command,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
  }

  #failure(code, error, { command, status, startedAt }) {
    this.#logger.warn?.('fullykiosk.rest.response', {
      command,
      ok: false,
      code,
      status,
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, code, error };
  }
}

export default FullyKioskRestClient;
