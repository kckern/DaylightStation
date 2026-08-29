export class DeviceFleetControlService {
  #devices; #configuration; #calls; #logger;
  constructor({ devices, configuration, callControl, logger = console }) {
    this.#devices = devices; this.#configuration = configuration; this.#calls = callControl; this.#logger = logger;
  }
  configuration(householdId) { return this.#configuration.householdDevices(householdId); }
  list() { return this.#devices.listDevices(); }
  async state(deviceId) {
    const device = this.#devices.get(deviceId);
    return device ? { kind: 'ok', state: await device.getState() } : { kind: 'not_found' };
  }
  async healAudioBridge({ force, deviceId }) {
    const ids = deviceId ? [deviceId] : this.#devices.listDeviceIds();
    const healed = [];
    for (const id of ids) {
      const device = this.#devices.get(id);
      if (!device) continue;
      const result = await device.healAudioBridge({ force });
      if (result && result.supported === false) continue;
      healed.push({ deviceId: id, ...result });
    }
    const ok = healed.every(result => result.ok !== false);
    this.#logger.info?.('device.router.heal-audio-bridge', { count: healed.length, force });
    return { ok, healed, ...(healed.length ? {} : { reason: 'no-eligible-devices' }) };
  }
  async powerOn(deviceId, display) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    this.#logger.info?.('device.router.powerOn', { deviceId, display });
    return { kind: 'ok', result: await device.powerOn(display) };
  }
  async powerOff(deviceId, { display, force }) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (this.#calls.hasActive(deviceId) && !force) {
      this.#logger.info?.('device.router.powerOff.blocked', { deviceId, reason: 'active-videocall' });
      return { kind: 'busy' };
    }
    if (force && this.#calls.hasActive(deviceId)) {
      this.#logger.info?.('device.router.powerOff.forced', { deviceId });
      await this.#calls.forceEnd(deviceId);
    }
    this.#logger.info?.('device.router.powerOff', { deviceId, display });
    return { kind: 'ok', result: await device.powerOff(display) };
  }
  async toggle(deviceId, display) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    this.#logger.info?.('device.router.toggle', { deviceId, display });
    return { kind: 'ok', result: await device.toggle(display) };
  }
  async reboot(deviceId) {
    this.#logger.info?.('device.router.reboot.start', { deviceId });
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    const result = await device.reboot();
    this.#logger.info?.('device.router.reboot.complete', { deviceId, ok: result.ok });
    return { kind: 'ok', result };
  }
  async volume(deviceId, level) {
    this.#logger.warn?.('device.volume.deprecated', { deviceId,
      note: 'Use PUT /api/v1/device/:id/session/volume instead' });
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('volume')) return { kind: 'unsupported' };
    this.#logger.info?.('device.router.volume', { deviceId, level });
    return { kind: 'ok', result: await device.setVolume(level) };
  }
  async audio(deviceId, audioDevice) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('audioDevice')) return { kind: 'unsupported' };
    this.#logger.info?.('device.router.audio', { deviceId, audioDevice });
    return { kind: 'ok', result: await device.setAudioDevice(audioDevice) };
  }
}
