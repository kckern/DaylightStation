import { IDeviceBluetooth } from '../../application/ports/IDeviceBluetooth.mjs';

export class AudioBridgeBluetoothAdapter extends IDeviceBluetooth {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    super();
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Bluetooth bridge URL must be an HTTP origin');
    }
    this.baseUrl = url.origin;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  state() { return this.request(''); }
  command(action, body) { return this.request(`/${action}`, body); }
  async request(path, body) {
    try {
      const response = await this.fetch(`${this.baseUrl}/bluetooth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      let result;
      try { result = await response.json(); } catch { throw Object.assign(new Error('Bluetooth bridge returned invalid JSON'), { status: 502 }); }
      if (!response.ok || result?.ok === false) {
        // Do not propagate arbitrary upstream text which can contain pairing secrets.
        throw Object.assign(new Error('Bluetooth did not accept the action. Refresh controller status.'), {
          status: response.status === 409 || result?.code === 'action_rejected' ? 409 : 502,
          code: 'bridge_rejected',
        });
      }
      const state = body === undefined;
      if (result?.ok !== true || (state && (!result.adapter || !Array.isArray(result.devices))) || (!state && result.accepted !== true)) {
        throw Object.assign(new Error('Bluetooth bridge returned an invalid response'), { status: 502 });
      }
      return result;
    } catch (error) {
      if (error.status) throw error;
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      throw Object.assign(new Error(timeout ? 'Bluetooth bridge timed out' : 'Bluetooth bridge is unreachable'), { status: timeout ? 504 : 502, code: timeout ? 'timeout' : 'unreachable' });
    }
  }
}
