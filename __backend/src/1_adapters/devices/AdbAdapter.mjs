/**
 * AdbAdapter - Android Debug Bridge CLI wrapper
 *
 * Provides low-level ADB operations for Android device control.
 * Used as a recovery mechanism when higher-level APIs (e.g., Fully Kiosk REST) are unreachable.
 *
 * @module adapters/devices
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export class AdbAdapter {
  #serial;
  #logger;
  #metrics;
  #execCommand;
  #execFileCommand;

  /**
   * @param {Object} config
   * @param {string} config.host - ADB target IP
   * @param {number} [config.port=5555] - ADB port
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   * @param {Function} [deps.execCommand] - Test seam for shell execution
   * @param {Function} [deps.execFileCommand] - Test seam for argv execution
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AdbAdapter requires host', {
        code: 'MISSING_CONFIG',
        field: 'host'
      });
    }

    this.#serial = `${config.host}:${config.port || 5555}`;
    this.#logger = deps.logger || console;
    this.#execCommand = deps.execCommand || execAsync;
    this.#execFileCommand = deps.execFileCommand || execFileAsync;

    this.#metrics = {
      startedAt: Date.now(),
      commands: 0,
      errors: 0,
      recoveries: 0
    };
  }

  /**
   * Connect to ADB device
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async connect() {
    const result = await this.#exec(`adb connect ${this.#serial}`);
    if (!result.ok) return result;

    // adb connect exits 0 even when device needs authorization.
    // Verify with a lightweight command to detect auth issues early.
    const verify = await this.#exec(`adb -s ${this.#serial} shell echo ok`);
    if (!verify.ok) {
      const isAuth = verify.error?.includes('authoriz') || verify.error?.includes('unauthorized');
      this.#logger.warn?.('adb.connect.verifyFailed', {
        serial: this.#serial,
        isAuth,
        error: verify.error
      });
      return {
        ok: false,
        error: isAuth
          ? 'device still authorizing'
          : verify.error
      };
    }

    return result;
  }

  /**
   * Run a shell command on the device.
   * Auto-reconnects once if the device is not found (cold ADB daemon, dropped connection).
   * @param {string} command - Shell command to run
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async shell(command) {
    const adbCommand = `adb -s ${this.#serial} shell ${JSON.stringify(command)}`;
    // A cold ADB daemon is expected to miss once before connect. Defer the
    // error log until we know whether this is a real command failure.
    const result = await this.#exec(adbCommand, { logFailure: false });

    if (!result.ok && this.#isDeviceNotFound(result.error)) {
      this.#logger.debug?.('adb.shell.disconnected', { serial: this.#serial, command });
      this.#logger.info?.('adb.shell.autoReconnect', { serial: this.#serial, command });
      const reconnect = await this.connect();
      if (reconnect.ok) {
        const retry = await this.#exec(adbCommand);
        if (retry.ok) {
          this.#metrics.recoveries++;
          this.#logger.info?.('adb.shell.recovered', { serial: this.#serial, command });
        }
        return retry;
      }
      return { ok: false, error: `reconnect failed: ${reconnect.error}` };
    }

    if (!result.ok) this.#logExecError(adbCommand, result);

    return result;
  }

  /**
   * Check if an error indicates the device is disconnected.
   * @private
   */
  #isDeviceNotFound(errorMsg) {
    if (!errorMsg) return false;
    return errorMsg.includes('not found') || errorMsg.includes('no devices') || errorMsg.includes('offline');
  }

  /**
   * Launch an Android activity
   * @param {string} activity - Fully qualified activity (e.g. "de.ozerov.fully/.TvActivity")
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async launchActivity(activity) {
    this.#logger.info?.('adb.launchActivity', { serial: this.#serial, activity });
    const result = await this.shell(`am start -n ${activity}`);

    if (result.ok) {
      this.#metrics.recoveries++;
    }

    return result;
  }

  /**
   * Launch an activity with array-form arguments (injection-safe).
   * @param {string[]} args - Arguments for 'am' command, e.g. ['start', '-n', 'pkg/Activity', '--es', 'key', 'val']
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async amStart(args) {
    this.#logger.info?.('adb.amStart', { serial: this.#serial, args });
    const result = await this.#execArgs(['shell', 'am', ...args]);
    if (result.ok) {
      this.#metrics.recoveries++;
    }
    return result;
  }

  /**
   * Check if a package's process is running
   * @param {string} packageName - Android package name
   * @returns {Promise<boolean>}
   */
  async isProcessRunning(packageName) {
    const result = await this.shell(`pidof ${packageName}`);
    return result.ok && !!result.output?.trim();
  }

  /**
   * Reboot the device
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async reboot() {
    this.#logger.info?.('adb.reboot', { serial: this.#serial });
    return this.#exec(`adb -s ${this.#serial} reboot`);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: 'adb',
      serial: this.#serial,
      uptime: Date.now() - this.#metrics.startedAt,
      commands: this.#metrics.commands,
      errors: this.#metrics.errors,
      recoveries: this.#metrics.recoveries
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Execute an ADB command
   * @private
   */
  async #exec(command, { logFailure = true } = {}) {
    this.#metrics.commands++;
    const startTime = Date.now();

    this.#logger.debug?.('adb.exec.start', { command, serial: this.#serial });

    try {
      const { stdout, stderr } = await this.#execCommand(command, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;

      this.#logger.debug?.('adb.exec.success', { command, elapsedMs, stdout: stdout?.trim() });

      return { ok: true, output: stdout?.trim(), stderr: stderr?.trim() };
    } catch (error) {
      this.#metrics.errors++;
      const elapsedMs = Date.now() - startTime;

      const result = { ok: false, error: error.message, code: error.code, elapsedMs };
      if (logFailure) this.#logExecError(command, result);

      return result;
    }
  }

  #logExecError(command, result) {
    this.#logger.error?.('adb.exec.error', {
      command,
      error: result.error,
      code: result.code,
      elapsedMs: result.elapsedMs,
    });
  }

  /**
   * Execute ADB with array arguments (no shell interpolation)
   * @private
   */
  async #execArgs(args) {
    this.#metrics.commands++;
    const startTime = Date.now();
    const fullArgs = ['-s', this.#serial, ...args];

    this.#logger.debug?.('adb.execArgs.start', { args: fullArgs });

    try {
      const { stdout, stderr } = await this.#execFileCommand('adb', fullArgs, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;
      this.#logger.debug?.('adb.execArgs.success', { elapsedMs, stdout: stdout?.trim() });
      return { ok: true, output: stdout?.trim(), stderr: stderr?.trim() };
    } catch (error) {
      this.#metrics.errors++;
      const elapsedMs = Date.now() - startTime;
      this.#logger.error?.('adb.execArgs.error', { args: fullArgs, error: error.message, elapsedMs });
      return { ok: false, error: error.message };
    }
  }
}

export default AdbAdapter;
