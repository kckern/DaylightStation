/**
 * requestContext — who is asking, for code far below the HTTP layer.
 *
 * A router wrapped with `withRequestContext` (0_system/http/middleware)
 * runs each request inside a small context: the caller's User-Agent and the
 * `X-Daylight-Device` header. Code further down the same async chain reads
 * `currentRequestContext()` — e.g. the media load recorder telling a Home
 * Assistant routine (`HomeAssistant/<ver>` User-Agent) from a person's send.
 *
 * Informational: absent outside a wrapped request (null), never trusted for
 * authorization.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * @param {{userAgent?:string|null, device?:string|null}} context
 * @param {Function} fn
 */
export function runWithRequestContext(context, fn) {
  return storage.run(Object.freeze({ ...context }), fn);
}

/** @returns {{userAgent?:string|null, device?:string|null}|null} */
export function currentRequestContext() {
  return storage.getStore() ?? null;
}
