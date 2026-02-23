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

  /**
   * @param {Object} config
   * @param {string} config.host - ADB target IP
   * @param {number} [config.port=5555] - ADB port
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
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
    return this.#exec(`adb connect ${this.#serial}`);
  }

  /**
   * Run a shell command on the device
   * @param {string} command - Shell command to run
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async shell(command) {
    return this.#exec(`adb -s ${this.#serial} shell ${JSON.stringify(command)}`);
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
  async #exec(command) {
    this.#metrics.commands++;
    const startTime = Date.now();

    this.#logger.debug?.('adb.exec.start', { command, serial: this.#serial });

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;

      this.#logger.debug?.('adb.exec.success', { command, elapsedMs, stdout: stdout?.trim() });

      return { ok: true, output: stdout?.trim(), stderr: stderr?.trim() };
    } catch (error) {
      this.#metrics.errors++;
      const elapsedMs = Date.now() - startTime;

      this.#logger.error?.('adb.exec.error', {
        command,
        error: error.message,
        code: error.code,
        elapsedMs
      });

      return { ok: false, error: error.message };
    }
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
      const { stdout, stderr } = await execFileAsync('adb', fullArgs, { timeout: 10_000 });
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
