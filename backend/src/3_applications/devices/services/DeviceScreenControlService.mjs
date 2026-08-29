export class DeviceScreenControlService {
  #devices; #configuration; #overrides; #midiWake; #logger; #nowMs;
  constructor({ devices, configuration, screenOverrides = null, midiWake = null, logger = console, nowMs = Date.now }) {
    this.#devices = devices; this.#configuration = configuration; this.#overrides = screenOverrides;
    this.#midiWake = midiWake; this.#logger = logger; this.#nowMs = nowMs;
  }
  #onMinutes() { return Number(this.#configuration.piano().button?.onHoldMinutes) || 10; }
  #offMinutes() { const cfg = this.#configuration.piano(); return Number(cfg.button?.offHoldMinutes)
    || Number(cfg.screensaver?.offCooldownMinutes) || 30; }
  override(deviceId) { return { override: this.#overrides?.get(deviceId) ?? null }; }
  async toggle(deviceId) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    let currentlyOn = false;
    try { currentlyOn = (await device.getStatus())?.screenOn === true; } catch { currentlyOn = false; }
    const next = !currentlyOn;
    if (this.#overrides) { if (next) this.#overrides.set(deviceId, 'on', this.#onMinutes()); else this.#overrides.clear(deviceId); }
    this.#logger.info?.('device.router.screen.toggle', { deviceId, next });
    const result = await device.setScreen(next);
    return { kind: 'ok', body: { screenOn: next, override: this.#overrides?.get(deviceId) ?? null, result } };
  }
  async setOverride(deviceId, state, requestedMinutes) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    const minutes = requestedMinutes > 0 ? requestedMinutes
      : (state === 'off' ? this.#offMinutes() : this.#onMinutes());
    if (state === 'off') {
      if (this.#midiWake?.suppressWakeUntil) this.#midiWake.suppressWakeUntil(this.#nowMs() + minutes * 60_000);
      else this.#overrides?.set(deviceId, 'off', minutes);
    } else this.#overrides?.set(deviceId, 'on', minutes);
    this.#logger.info?.('device.router.screen.override', { deviceId, state, minutes });
    const result = await device.setScreen(state === 'on');
    return { kind: 'ok', body: { ok: true, override: this.#overrides?.get(deviceId) ?? null, result } };
  }
  async setScreen(deviceId, state) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    this.#logger.info?.('device.router.setScreen', { deviceId, state });
    return { kind: 'ok', result: await device.setScreen(state === 'on') };
  }
  suppressWake(deviceId, requestedMinutes) {
    const minutes = requestedMinutes > 0 ? requestedMinutes : 30;
    const until = this.#nowMs() + minutes * 60_000;
    this.#logger.info?.('device.router.suppressWake', { deviceId, minutes, until });
    if (this.#midiWake?.suppressWakeUntil) {
      this.#midiWake.suppressWakeUntil(until); return { ok: true, until, relayed: true };
    }
    return { ok: true, until, relayed: false };
  }
}
