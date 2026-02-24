// backend/src/1_adapters/devices/AdbLauncher.mjs
import { IDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { AdbAdapter } from './AdbAdapter.mjs';

export class AdbLauncher extends IDeviceLauncher {
  #configService;
  #logger;

  constructor(config) {
    super();
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #getAdbConfig(deviceId) {
    const deviceConfig = this.#configService.getDeviceConfig(deviceId);
    if (!deviceConfig) return null;
    const fallback = deviceConfig.content_control?.fallback;
    if (fallback?.provider === 'adb' && fallback.host) return fallback;
    return null;
  }

  async canLaunch(deviceId) {
    return !!this.#getAdbConfig(deviceId);
  }

  async launch(deviceId, launchIntent) {
    const adbConfig = this.#getAdbConfig(deviceId);
    if (!adbConfig) {
      throw new ValidationError('Device does not have ADB configured', {
        code: 'NO_ADB_CONFIG',
        field: 'deviceId',
        value: deviceId
      });
    }

    const adb = new AdbAdapter(
      { host: adbConfig.host, port: adbConfig.port },
      { logger: this.#logger }
    );
    await adb.connect();

    const args = ['start', '-n', launchIntent.target];
    for (const [key, val] of Object.entries(launchIntent.params)) {
      this.#validateIntentParam(key, val);
      // Shell-quote values for Android shell (adb shell am splits on spaces).
      // Escape embedded single quotes: ' -> '\'' (end quote, escaped quote, start quote)
      const quoted = `'${val.replace(/'/g, "'\\''")}'`;
      args.push('--es', key, quoted);
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

  #validateIntentParam(key, val) {
    const shellMeta = /[;|&`${}<>\\]/;
    if (shellMeta.test(key)) {
      throw new ValidationError('Intent param key contains disallowed characters', { field: key });
    }
    if (shellMeta.test(val)) {
      throw new ValidationError('Intent param value contains disallowed characters', { field: key, value: val });
    }
  }
}

export default AdbLauncher;
