const BASE = 'http://localhost:8770/bluetooth';

/** Local native bridge only. An accepted command must be verified by a later state read. */
export function createBluetoothClient({ fetchImpl = (...args) => fetch(...args), timeoutMs = 8000 } = {}) {
  async function request(path, body, { signal } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(`${BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('Invalid Bluetooth response'); }
      if (!response.ok || result?.ok === false) {
        const error = new Error(result?.error || `Bluetooth request failed (${response.status})`);
        error.code = result?.code || 'request_failed';
        throw error;
      }
      if (result?.ok !== true || (body === undefined && (!result.adapter || !Array.isArray(result.devices)))) {
        throw new Error('Invalid Bluetooth response');
      }
      if (body !== undefined && result.accepted !== true) {
        throw Object.assign(new Error('Bluetooth command was not accepted.'), { code: 'not_accepted' });
      }
      return result;
    } catch (error) {
      if (timedOut) throw Object.assign(new Error('Bluetooth request timed out. Try again.'), { code: 'timeout' });
      if (error?.name === 'AbortError') throw error;
      if (error instanceof TypeError) throw Object.assign(new Error('Couldn’t reach the tablet Bluetooth service.'), { code: 'unreachable' });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    state: (options) => request('', undefined, options),
    command: (action, body = {}, options) => request(`/${action}`, body, options),
  };
}
