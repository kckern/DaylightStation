export class DeviceRecoveryService {
  #devices; #requiresCamera; #screenAddressResolver; #scheduler; #logger;
  constructor({ devices, contentRequiresCamera, screenAddressResolver, scheduler, logger = console }) {
    if (!scheduler?.wait) throw new Error('DeviceRecoveryService requires scheduler');
    this.#devices = devices; this.#requiresCamera = contentRequiresCamera; this.#screenAddressResolver = screenAddressResolver; this.#scheduler = scheduler; this.#logger = logger;
  }
  async recover(deviceId, reloadQuery) {
    this.#logger.info?.('device.router.recover.start', { deviceId });
    const device = this.#devices.get(deviceId); if (!device) return { kind: 'not_found' };
    let adbOk = false;
    try {
      const rebootResult = await device.reboot(); adbOk = rebootResult.ok;
      this.#logger.info?.('device.router.recover.adb', { deviceId, ok: adbOk });
    } catch (err) { this.#logger.warn?.('device.router.recover.adb.failed', { deviceId, error: err.message }); }
    if (!adbOk) {
      this.#logger.info?.('device.router.recover.power-cycle', { deviceId });
      try {
        await device.powerOff(); await this.#scheduler.wait(10_000); await device.powerOn(); await this.#scheduler.wait(60_000);
      } catch (err) {
        this.#logger.error?.('device.router.recover.power-cycle.failed', { deviceId, error: err.message });
        return { kind: 'failed', error: 'Recovery failed: ' + err.message, method: 'power-cycle' };
      }
    } else await this.#scheduler.wait(15_000);
    try {
      const skipCameraCheck = reloadQuery ? !this.#requiresCamera(reloadQuery) : true;
      await device.prepareForContent({ skipCameraCheck });
      if (reloadQuery) await device.loadContent(this.#screenAddressResolver.resolve(device).path, reloadQuery);
    } catch (err) { this.#logger.warn?.('device.router.recover.reload.failed', { deviceId, error: err.message }); }
    const method = adbOk ? 'adb-restart' : 'power-cycle';
    this.#logger.info?.('device.router.recover.complete', { deviceId, method });
    return { kind: 'ok', body: { ok: true, method } };
  }
}
