import { IDeviceBluetooth } from '../../application/ports/IDeviceBluetooth.mjs';

/**
 * Controller pairing on a device running the DaylightStation Android kiosk
 * app. The app serves the same `/bluetooth` routes the audio-bridge app does
 * (its `bluetooth-controls` capability, in gamepad mode), on the device's one
 * control port and behind the control API token. The rest client carries the
 * token; this class never sees it.
 *
 * Outcomes are the ones AudioBridgeBluetoothAdapter produces, so the service
 * and router above treat both alike, plus two this app can give:
 *
 *   | From the device                         | status | code            |
 *   |-----------------------------------------|--------|-----------------|
 *   | HTTP 409, or a body `code: action_rejected` | 409 | bridge_rejected |
 *   | any other refusal or device-side failure | 502   | bridge_rejected |
 *   | HTTP 401                                 | 502   | auth_rejected   |
 *   | HTTP 405 or 501                          | 501   | unsupported     |
 *   | not JSON                                 | 502   | (none)          |
 *   | timeout                                  | 504   | timeout         |
 *   | unreachable                              | 502   | unreachable     |
 *
 * As with the audio-bridge adapter, nothing the device said is passed on:
 * upstream text can contain pairing secrets.
 */
export class DaylightAndroidBluetoothAdapter extends IDeviceBluetooth {
  #rest; #timeoutMs;

  /** @param {{restClient: {get: Function, post: Function}, timeoutMs?: number}} deps */
  constructor({ restClient, timeoutMs = 5000 } = {}) {
    super();
    if (!restClient?.get || !restClient?.post) throw new Error('DaylightAndroidBluetoothAdapter requires restClient');
    this.#rest = restClient;
    this.#timeoutMs = timeoutMs;
  }

  state() { return this.#request(''); }
  command(action, body) { return this.#request(`/${action}`, body); }

  async #request(path, body) {
    const isState = body === undefined;
    let result;
    try {
      result = isState
        ? await this.#rest.get(`/bluetooth${path}`, { timeout: this.#timeoutMs })
        : await this.#rest.post(`/bluetooth${path}`, body, { timeout: this.#timeoutMs });
    } catch {
      throw failure('Bluetooth bridge is unreachable', 502, 'unreachable');
    }

    if (!result?.ok) throw outcome(result);
    const data = result.data;
    if (data?.ok !== true || (isState && (!data.adapter || !Array.isArray(data.devices))) || (!isState && data.accepted !== true)) {
      throw failure('Bluetooth bridge returned an invalid response', 502);
    }
    return data;
  }
}

function failure(message, status, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function outcome(result) {
  switch (result?.code) {
    case 'TIMEOUT': return failure('Bluetooth bridge timed out', 504, 'timeout');
    case 'UNREACHABLE': return failure('Bluetooth bridge is unreachable', 502, 'unreachable');
    case 'INVALID_RESPONSE': return failure('Bluetooth bridge returned invalid JSON', 502);
    case 'AUTH_REJECTED': return failure('The kiosk app rejected the configured token', 502, 'auth_rejected');
    case 'UNSUPPORTED': return failure('This device does not support that controller action', 501, 'unsupported');
    default:
  }
  if (result?.status === 405) return failure('This device does not support that controller action', 501, 'unsupported');
  return failure(
    'Bluetooth did not accept the action. Refresh controller status.',
    result?.status === 409 || result?.deviceCode === 'action_rejected' ? 409 : 502,
    'bridge_rejected',
  );
}

export default DaylightAndroidBluetoothAdapter;
