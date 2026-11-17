/**
 * Client for the DaylightStation Android kiosk app's control API.
 *
 * The app serves JSON routes on its control port and authenticates with the
 * `X-Daylight-Token` header. This client owns the header, so the token never
 * reaches a URL, a log line or an error message. Request logs carry the names
 * of body and query fields, never their values: those can hold private URLs,
 * overlay messages or speech text.
 *
 * Results use the shape the Fully client returns, `{ ok: true, data }` or
 * `{ ok: false, code, error }`, so callers of either client read them alike.
 *
 * | Condition                          | code               |
 * |------------------------------------|--------------------|
 * | HTTP 401                           | AUTH_REJECTED      |
 * | HTTP 501                           | UNSUPPORTED        |
 * | other HTTP 4xx, or `ok: false`     | COMMAND_REJECTED   |
 * | any other non-2xx status           | HTTP_ERROR         |
 * | timeout                            | TIMEOUT            |
 * | connection refused / no route      | UNREACHABLE        |
 * | non-JSON where JSON was expected   | INVALID_RESPONSE   |
 *
 * Contract: ops:docs/superpowers/specs/2026-11-16-daylight-android-control-api.md
 *
 * @module adapters/devices
 */

const TOKEN_HEADER = 'X-Daylight-Token';
const DEFAULT_PORT = 8780;
/** Transport errors raised before a request leaves this host. */
const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);

export class DaylightAndroidRestClient {
  #host;
  #port;
  #token;
  #httpClient;
  #logger;

  constructor({ host, port = DEFAULT_PORT, token } = {}, { httpClient, logger = console } = {}) {
    if (!host) throw new Error('DaylightAndroidRestClient requires host');
    if (!httpClient?.get || !httpClient?.post || !httpClient?.delete) {
      throw new Error('DaylightAndroidRestClient requires httpClient with get, post and delete');
    }
    this.#host = host;
    this.#port = port || DEFAULT_PORT;
    this.#token = token || '';
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  /**
   * @param {string} route - e.g. `/kiosk/status`
   * @param {{query?: Object, binary?: boolean, timeout?: number}} [options]
   */
  get(route, options = {}) {
    return this.#request('GET', route, options);
  }

  /**
   * @param {string} route
   * @param {Object} [body] - sent as JSON; an empty object when omitted
   * @param {{query?: Object, timeout?: number}} [options]
   */
  post(route, body = {}, options = {}) {
    return this.#request('POST', route, { ...options, body: body ?? {} });
  }

  /**
   * @param {string} route
   * @param {{query?: Object, timeout?: number}} [options]
   */
  delete(route, options = {}) {
    return this.#request('DELETE', route, options);
  }

  async #request(method, route, { query = {}, body, binary = false, timeout = 10_000 } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const queryString = search.toString();
    const url = `http://${this.#host}:${this.#port}${route}${queryString ? `?${queryString}` : ''}`;
    const config = {
      timeout,
      headers: {
        [TOKEN_HEADER]: this.#token,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      // Every status comes back as a response, so the device's own `error` and
      // `reason` survive instead of being replaced by a thrown status message.
      validateStatus: () => true,
      ...(binary ? { responseType: 'arraybuffer' } : {}),
    };

    const context = { method, route, startedAt: Date.now() };
    this.#logger.debug?.('daylightandroid.rest.request', {
      method,
      route,
      host: this.#host,
      port: this.#port,
      queryKeys: [...search.keys()],
      ...(method === 'POST' ? { bodyKeys: Object.keys(body || {}) } : {}),
    });

    let response;
    try {
      response = method === 'POST'
        ? await this.#httpClient.post(url, body, config)
        : await this.#httpClient[method === 'GET' ? 'get' : 'delete'](url, config);
    } catch (error) {
      // A client that ignores validateStatus throws with the response attached.
      if (error?.response?.status) return this.#interpret(error.response, binary, context);
      const message = this.#redact(error?.message || 'Request failed');
      const timedOut = /abort|timeout|ETIMEDOUT|ECONNABORTED/i
        .test(`${error?.code || ''} ${error?.name || ''} ${message}`);
      // A connection that was never made means the device never saw the
      // request. A caller that expects the device to drop the connection (a
      // restart, a reboot) needs to tell that apart from a drop afterwards.
      const neverSent = !timedOut && NEVER_CONNECTED.has(error?.code);
      return this.#failure(timedOut ? 'TIMEOUT' : 'UNREACHABLE', message, { ...context, neverSent });
    }
    return this.#interpret(response, binary, context);
  }

  #interpret(response, binary, context) {
    const status = response?.status ?? 200;
    const payload = parseJson(response?.data);

    if (status < 200 || status >= 300) {
      const code = status === 401 ? 'AUTH_REJECTED'
        : status === 501 ? 'UNSUPPORTED'
          : status >= 400 && status < 500 ? 'COMMAND_REJECTED'
            : 'HTTP_ERROR';
      return this.#failure(code, `HTTP ${status}`, { ...context, status, payload });
    }

    if (binary) {
      // A refusal can still arrive as JSON on a route that normally sends bytes.
      if (payload && payload.ok === false) {
        return this.#failure('COMMAND_REJECTED', 'Command was rejected', { ...context, status, payload });
      }
      const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || []);
      this.#success(context);
      return { ok: true, data, headers: response.headers || {} };
    }

    if (!payload || typeof payload.ok !== 'boolean') {
      return this.#failure('INVALID_RESPONSE', 'Device returned an unexpected response', { ...context, status });
    }
    if (!payload.ok) {
      return this.#failure('COMMAND_REJECTED', 'Command was rejected', { ...context, status, payload });
    }
    this.#success(context);
    return { ok: true, data: payload };
  }

  #success({ method, route, startedAt }) {
    this.#logger.debug?.('daylightandroid.rest.response', {
      method, route, ok: true, durationMs: Date.now() - startedAt,
    });
  }

  /**
   * `deviceError` is the device's own `error` word (`not_installed`,
   * `unsupported`, ...) and `reason` its explanation. Both are appended to the
   * message, since the generic code cannot tell a caller which refusal it was.
   */
  #failure(code, error, { method, route, status, startedAt, payload, neverSent } = {}) {
    const deviceError = typeof payload?.error === 'string' ? payload.error : undefined;
    const reason = typeof payload?.reason === 'string' ? payload.reason : undefined;
    const detail = [deviceError, reason].filter(Boolean).join(' - ');
    this.#logger.warn?.('daylightandroid.rest.response', {
      method,
      route,
      ok: false,
      code,
      status,
      durationMs: Date.now() - startedAt,
      ...(detail ? { detail } : {}),
    });
    return {
      ok: false,
      code,
      error: detail ? `${error}: ${detail}` : error,
      ...(status ? { status } : {}),
      ...(deviceError ? { deviceError } : {}),
      ...(reason ? { reason } : {}),
      ...(neverSent ? { neverSent: true } : {}),
    };
  }

  /** Transport errors can echo request headers; the token must not ride along. */
  #redact(text) {
    return this.#token ? String(text).split(this.#token).join('[redacted]') : String(text);
  }
}

/** A plain JSON object from an object, a string or bytes; null for anything else. */
function parseJson(data) {
  let value = data;
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength);
    const text = buffer.subarray(0, 64 * 1024).toString('utf8').trimStart();
    if (!text.startsWith('{')) return null;
    value = text;
  }
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export default DaylightAndroidRestClient;
