import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { DEVICE_HEADER } from '../schoolDevice.js';

const clone = value => {
  try { return value == null ? value : structuredClone(value); } catch { return value; }
};

/** Status-aware, surface-owned transport. Only in-flight, uncancellable GETs are shared. */
export function createSchoolTransport({
  base = '/api/v1/school', deviceId = null,
  fetchImpl = (...args) => globalThis.fetch(...args), logger,
} = {}) {
  const pending = new Map();
  let generation = 0;
  const diagnostic = (kind, method, status) => {
    // Never log URLs, bodies, exception messages or headers: they can contain grants or learner text.
    (logger ?? getLogger().child({ component: 'school-transport' })).warn('school.transport.failed', { kind, method, status });
  };

  async function send(url, { method, body, raw, headers, signal, timeoutMs, responseType }) {
    const controller = new AbortController();
    let timer;
    let timedOut = false;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const cancel = () => {
      controller.abort();
      rejectAbort(new Error('cancelled'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
    }
    try {
      const operation = async () => {
        if (controller.signal.aborted) throw new Error('cancelled');
        const response = await fetchImpl(url, {
          method, credentials: 'same-origin', ...(headers === undefined ? {} : { headers }), signal: controller.signal,
          ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
        });
        let data = null;
        if (responseType === 'response') data = response;
        else if (response.status !== 204 && response.status !== 205 && method !== 'HEAD') {
          try {
            data = responseType === 'blob' && response.ok ? await response.blob()
              : responseType === 'text' ? await response.text() : await response.json();
          } catch (error) {
            if (error?.name === 'AbortError' || controller.signal.aborted) throw error;
            const kind = responseType === 'json' || !response.ok ? 'invalid-json' : 'invalid-response';
            diagnostic(kind, method, response.status);
            return { ok: false, status: response.status, data: null, error: { kind } };
          }
        }
        if (response.ok && method !== 'GET' && method !== 'HEAD') {
          generation += 1;
          pending.clear();
        }
        return { ok: response.ok, status: response.status, data };
      };
      return await Promise.race([operation(), aborted]);
    } catch (error) {
      const kind = timedOut ? 'timeout' : controller.signal.aborted || error?.name === 'AbortError' ? 'aborted' : 'network';
      diagnostic(kind, method, 0);
      return { ok: false, status: 0, data: null, error: { kind } };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function request(path, {
    method, body, raw = false, headers, signal, timeoutMs = 35_000, responseType = 'json', fresh = false,
  } = {}) {
    method = (method ?? (body === undefined ? 'GET' : 'POST')).toUpperCase();
    const scopedHeaders = headers === undefined && body === undefined && !deviceId ? undefined : {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers, ...(deviceId ? { [DEVICE_HEADER]: String(deviceId) } : {}),
    };
    const url = path.startsWith('/') && !path.startsWith('/api/') ? base + path : path;
    const options = { method, body, raw, headers: scopedHeaders, signal, timeoutMs, responseType };
    // Caller-controlled aborts have private lifetimes. A refresh replaces only its own key.
    if (method !== 'GET' || signal || raw || responseType === 'response') return send(url, options);
    const key = JSON.stringify([generation, url, Object.entries(scopedHeaders ?? {}).sort(), responseType, timeoutMs]);
    let started = fresh ? null : pending.get(key);
    if (!started) {
      started = send(url, options).finally(() => {
        if (pending.get(key) === started) pending.delete(key);
      });
      pending.set(key, started);
    }
    return started.then(result => ({ ...result, data: responseType === 'json' ? clone(result.data) : result.data }));
  }
  return { request };
}
