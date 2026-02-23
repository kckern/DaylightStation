// backend/src/1_adapters/devices/AdbLauncher.mjs
import { IDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * IDeviceLauncher implementation using ADB.
 * Translates abstract launch intents into Android activity manager commands.
 */
export class AdbLauncher extends IDeviceLauncher {
  #deviceService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.deviceService - DeviceService for looking up device configs and ADB adapters
   * @param {Object} [config.logger]
   */
  constructor(config) {
    super();
    this.#deviceService = config.deviceService;
    this.#logger = config.logger || console;
  }

  /** @inheritdoc */
  async canLaunch(deviceId) {
    const deviceConfig = this.#deviceService.getDeviceConfig(deviceId);
    return !!deviceConfig?.adb;
  }

  /** @inheritdoc */
  async launch(deviceId, launchIntent) {
    const adb = this.#deviceService.getAdbAdapter(deviceId);
    await adb.connect();

    const args = ['start', '-n', launchIntent.target];
    for (const [key, val] of Object.entries(launchIntent.params)) {
      this.#validateIntentParam(key, val);
      args.push('--es', key, val);
    }

    this.#logger.info?.('launch.adb.executing', { deviceId, target: launchIntent.target, paramCount: Object.keys(launchIntent.params).length });

    const result = await adb.amStart(args);

    if (!result.ok) {
      this.#logger.error?.('launch.adb.failed', { deviceId, error: result.error });
      throw new Error(`ADB launch failed: ${result.error}`);
    }

    this.#logger.info?.('launch.adb.success', { deviceId });
    return result;
  }

  /**
   * Defense-in-depth: reject values with shell metacharacters.
   * Array-form execution doesn't interpret them, but we reject as a safety net.
   * Single quotes and spaces are allowed (common in ROM filenames).
   * @private
   */
  #validateIntentParam(key, val) {
    const shellMeta = /[;|&`${}[\]<>!\\]/;
    if (shellMeta.test(key)) {
      throw new ValidationError('Intent param key contains disallowed characters', { field: key });
    }
    if (shellMeta.test(val)) {
      throw new ValidationError('Intent param value contains disallowed characters', { field: key, value: val });
    }
  }
}

export default AdbLauncher;
