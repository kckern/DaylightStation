export class DeviceFleetControlService {
  #devices; #configuration; #calls; #volumeBoosts; #scheduler; #boostTimers; #logger;
  constructor({ devices, configuration, callControl, volumeBoosts = null, scheduler = null, logger = console }) {
    this.#devices = devices; this.#configuration = configuration; this.#calls = callControl;
    this.#volumeBoosts = volumeBoosts; this.#scheduler = scheduler;
    this.#boostTimers = new Map(); this.#logger = logger;
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
  /**
   * The everyday volume ceiling for a device, and where it came from. A live
   * boost window raises it; the device's own boost_max is the hard limit that
   * neither this nor a boost may exceed (Device.setVolume enforces that too).
   * @returns {{ceiling:number|null, source:'boost'|'cap'|'ungoverned', until?:number}}
   */
  #volumeCeiling(deviceId, device) {
    const { cap, boostMax } = device.volumePolicy ?? { cap: null, boostMax: null };
    const boost = this.#volumeBoosts?.get(deviceId) ?? null;
    if (boost) {
      const ceiling = boostMax === null ? boost.ceiling : Math.min(boost.ceiling, boostMax);
      return { ceiling, source: 'boost', until: boost.until };
    }
    return cap === null
      ? { ceiling: null, source: 'ungoverned' }
      : { ceiling: cap, source: 'cap' };
  }

  async volume(deviceId, level) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('volume')) return { kind: 'unsupported' };

    // Deprecation is about the ROUTE, so it belongs after the checks that decide
    // whether anything happens at all. Emitted first, it was the only volume
    // event an unsupported device produced — which read as "the volume was set,
    // via a legacy path" when in fact nothing was.
    this.#logger.warn?.('device.volume.deprecated', { deviceId,
      note: 'Use PUT /api/v1/device/:id/session/volume instead' });

    const { ceiling, source, until } = this.#volumeCeiling(deviceId, device);
    const requested = level;
    if (ceiling !== null && level > ceiling) level = ceiling;
    const capped = level !== requested;

    this.#logger.info?.('device.router.volume', {
      deviceId, level, ceilingSource: source,
      ...(ceiling !== null && { ceiling }),
      ...(until && { boostUntil: new Date(until).toISOString() }),
      ...(capped && { requested, capped: true }),
    });
    return { kind: 'ok', result: await device.setVolume(level), ...(capped && { capped: true, requested }) };
  }

  /** Current hardware level plus the policy governing it. */
  async volumeState(deviceId) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('volume')) return { kind: 'unsupported' };
    const { ceiling, source, until } = this.#volumeCeiling(deviceId, device);
    const reading = await device.getVolume();
    return { kind: 'ok', result: {
      ...reading,
      ceiling, ceilingSource: source,
      ...(until && { boostUntil: new Date(until).toISOString() }),
    } };
  }

  /**
   * Open a time-boxed window allowing this device above its everyday cap, and
   * apply the boosted level immediately. On expiry the cap is re-applied, so the
   * override genuinely ends rather than merely stopping being renewed.
   */
  async boostVolume(deviceId, { level, minutes }) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('volume')) return { kind: 'unsupported' };
    if (!this.#volumeBoosts) return { kind: 'unsupported' };

    const { cap, boostMax } = device.volumePolicy ?? { cap: null, boostMax: null };
    if (cap === null) return { kind: 'ungoverned' };

    const requested = level;
    const ceiling = boostMax === null ? level : Math.min(level, boostMax);
    const entry = this.#volumeBoosts.set(deviceId, ceiling, minutes);

    this.#logger.warn?.('device.volume.boost', {
      deviceId, ceiling, minutes, cap, boostMax,
      until: new Date(entry.until).toISOString(),
      ...(ceiling !== requested && { requested, capped: true }),
    });

    const result = await device.setVolume(ceiling);
    this.#scheduleBoostExpiry(deviceId, device, entry, cap);
    return { kind: 'ok', result: {
      ...result, ceiling, cap, boostMax,
      until: new Date(entry.until).toISOString(),
      ...(ceiling !== requested && { requested, capped: true }),
    } };
  }

  /** Drop a boost window early and return the device to its cap. */
  async clearVolumeBoost(deviceId) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!this.#volumeBoosts) return { kind: 'unsupported' };
    this.#volumeBoosts.clear(deviceId);
    this.#boostTimers.get(deviceId)?.();
    this.#boostTimers.delete(deviceId);
    const { cap } = device.volumePolicy ?? { cap: null };
    this.#logger.info?.('device.volume.boost.cleared', { deviceId, restoredTo: cap });
    if (cap === null) return { kind: 'ok', result: { ok: true, cleared: true } };
    return { kind: 'ok', result: { ...(await device.setVolume(cap)), cleared: true, restoredTo: cap } };
  }

  #scheduleBoostExpiry(deviceId, device, entry, cap) {
    // A replaced window must not be reverted by the timer it superseded.
    this.#boostTimers.get(deviceId)?.();
    this.#boostTimers.delete(deviceId);
    if (!this.#scheduler?.after) return;

    const delay = Math.max(0, entry.until - Date.now());
    const cancel = this.#scheduler.after(delay, async () => {
      this.#boostTimers.delete(deviceId);
      // Only revert if the window really is over. A boost renewed between the
      // timer firing and this check is still live and must be left alone.
      if (this.#volumeBoosts?.get(deviceId)) return;
      this.#logger.info?.('device.volume.boost.expired', { deviceId, restoredTo: cap });
      try {
        await device.setVolume(cap);
      } catch (error) {
        this.#logger.warn?.('device.volume.boost.restore-failed', { deviceId, error: error.message });
      }
    });
    this.#boostTimers.set(deviceId, cancel);
  }
  async audio(deviceId, audioDevice) {
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    if (!device.hasCapability('audioDevice')) return { kind: 'unsupported' };
    this.#logger.info?.('device.router.audio', { deviceId, audioDevice });
    return { kind: 'ok', result: await device.setAudioDevice(audioDevice) };
  }
}
