import { getDeviceId } from '../../../../../frontend/src/lib/deviceIdentity.js';

export function currentBluetoothDeviceId() {
  const identity = getDeviceId();
  return identity.startsWith('fleet:') ? identity.slice(6) : null;
}
export function createBluetoothClient({ deviceId, fetchImpl = (...args) => fetch(...args), timeoutMs = 7000 }) {
  async function request(action, body, { signal } = {}) {
    if (!deviceId) throw new Error('This screen has no fleet device identity. Controller recovery is unavailable.');
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let expired = false;
    const timer = setTimeout(() => { expired = true; abort.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(`/api/v1/arcade-bluetooth/${encodeURIComponent(deviceId)}${action ? `/${action}` : ''}`, {
        method: body === undefined ? 'GET' : 'POST', signal: abort.signal, cache: 'no-store',
        headers: { 'X-Daylight-Device': getDeviceId(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'Controller recovery is unavailable.');
      if (body !== undefined && result.accepted !== true) throw new Error('Controller action was not accepted.');
      if (body === undefined && (!result.adapter || !Array.isArray(result.devices))) throw new Error('Controller status is invalid.');
      return result;
    } catch (error) {
      if (expired) throw new Error('Controller request timed out. Try again.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return { state: (options) => request('', undefined, options), command: (action, body = {}, options) => request(action, body, options) };
}
