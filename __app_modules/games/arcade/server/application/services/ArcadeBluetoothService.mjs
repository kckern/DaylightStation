const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
/** Controller-specific pairing words live in the device's `bluetooth_bridge.pairing`, never in code. */
export function pairingGuide(pairing) {
  if (!pairing || typeof pairing !== 'object') return null;
  const steps = (Array.isArray(pairing.steps) ? pairing.steps : []).map(text).filter(Boolean);
  if (!steps.length) return null;
  return { mode: text(pairing.mode), steps, troubleshoot: text(pairing.troubleshoot) };
}
const actions = new Set(['scan', 'scan/stop', 'pair', 'unpair', 'connect', 'disconnect', 'pairing']);
export class ArcadeBluetoothService {
  constructor({ deviceFor, adapterFor, logger = {} }) { Object.assign(this, { deviceFor, adapterFor, logger }); }
  adapter(deviceId) {
    const device = this.deviceFor(deviceId);
    if (!device) fail(404, 'Unknown arcade device');
    if (!device.bluetooth_bridge?.url) fail(503, 'Controller recovery is not configured for this device');
    return this.adapterFor(device.bluetooth_bridge.url);
  }
  async state(deviceId) {
    const state = await this.adapter(deviceId).state();
    const guide = pairingGuide(this.deviceFor(deviceId).bluetooth_bridge.pairing);
    return guide ? { ...state, guide } : state;
  }
  async command(deviceId, action, body) {
    if (!actions.has(action) || !body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid Bluetooth action');
    let input = {};
    if (action === 'scan') {
      const durationMs = body.durationMs ?? 12000;
      if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 30000) fail(400, 'Discovery duration must be 1000–30000 milliseconds');
      input = { durationMs };
    } else if (action !== 'scan/stop') {
      if (typeof body.address !== 'string' || !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(body.address)) fail(400, 'Select a valid controller address');
      input = { address: body.address.toUpperCase() };
      if (action === 'connect' || action === 'disconnect') {
        if (body.profile !== 'input') fail(400, 'Controller profile must be input');
        input.profile = 'input';
      }
      if (action === 'pairing') {
        if (typeof body.accept !== 'boolean') fail(400, 'A pairing reply is required');
        input.accept = body.accept;
        if (body.pin !== undefined) {
          if (typeof body.pin !== 'string' || !body.pin || Buffer.byteLength(body.pin) > 16 || /[\x00-\x1f\x7f]/.test(body.pin)) fail(400, 'PIN must contain 1–16 bytes without control characters');
          input.pin = body.pin;
        }
      }
    }
    const adapter = this.adapter(deviceId);
    this.logger.info?.('arcade.bluetooth.command', { deviceId, action });
    return adapter.command(action, input);
  }
}
