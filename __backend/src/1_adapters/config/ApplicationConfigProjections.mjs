



export class EntropyConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  sources() {
    const sources = this.configService.getAppConfig?.('entropy')?.sources || {};
    return Object.fromEntries(Object.entries(sources).map(([sourceId, config]) => [sourceId, {
      ...config,
      datasetId: config.dataPath || sourceId,
    }]));
  }
}








/** Normalizes household/device configuration into composition-ready topology. */
export class HouseholdConfigProjection {
  constructor({ configService }) { this.configService = configService; }

  usernames(householdId) {
    return (this.configService.getHouseholdUsers(householdId) || [])
      .map((user) => typeof user === 'string' ? user : (user?.username || user?.userId || user?.name))
      .filter(Boolean);
  }

  #devices(householdId) {
    return this.configService.getHouseholdDevices(householdId)?.devices || {};
  }

  fileServer(householdId) {
    return Object.values(this.#devices(householdId)).find((device) => device.file_server)?.file_server || null;
  }

  defaultBarcodeScreen(householdId) {
    return Object.values(this.#devices(householdId))
      .find((device) => device.type === 'barcode-scanner')?.target_screen || null;
  }

  findDeviceByConstraint(constraint, householdId) {
    for (const [id, device] of Object.entries(this.#devices(householdId))) {
      if (constraint === 'android' && device.content_control?.fallback?.provider === 'adb') return id;
      if (device.type?.includes(constraint)) return id;
    }
    return null;
  }

  barcodeTopology(householdId) {
    const devices = this.#devices(householdId);
    const scannerIds = [];
    const displayScripts = {};
    const screenToDevice = {};
    for (const [id, device] of Object.entries(devices)) {
      if (device.type === 'barcode-scanner') scannerIds.push(id);
      const topic = device.content_control?.topic;
      const scripts = Object.values(device.device_control?.displays || {})
        .filter((display) => display.on_script)
        .map((display) => display.on_script);
      if (topic && scripts.length > 0) displayScripts[topic] = scripts;
      if (device.screen_path) screenToDevice[device.screen_path.replace(/^\/screen\//, '')] = id;
    }
    const screenNames = [...new Set([
      ...Object.keys(screenToDevice),
      ...Object.keys(displayScripts),
      ...Object.values(devices).map((device) => device.content_control?.topic).filter(Boolean),
    ])];
    return { scannerIds, displayScripts, screenToDevice, screenNames };
  }

  shutdownPolicy(raw = {}) {
    return {
      durationSeconds: raw.duration_seconds,
      reconcileSeconds: raw.reconcile_seconds,
      targets: [
        ...(raw.targets?.school_screen_ids || []).map((id) => `school:${id}`),
        ...(raw.targets?.piano_device_ids || []).map((id) => `piano:${id}`),
      ],
    };
  }
}
