/** Resolves a screen fallback to its configured device and wakes it with content. */
export class LoadScreenFallback {
  constructor({ deviceForScreen, wakeAndLoad } = {}) {
    if (typeof deviceForScreen !== 'function' || !wakeAndLoad?.execute) {
      throw new Error('LoadScreenFallback requires deviceForScreen and wakeAndLoad');
    }
    this.deviceForScreen = deviceForScreen;
    this.wakeAndLoad = wakeAndLoad;
  }

  execute(screen, content) {
    const deviceId = this.deviceForScreen(screen);
    return deviceId ? this.wakeAndLoad.execute(deviceId, content) : undefined;
  }
}

export default LoadScreenFallback;
