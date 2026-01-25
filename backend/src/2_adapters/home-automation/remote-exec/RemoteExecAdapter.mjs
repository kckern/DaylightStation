/**
 * RemoteExecAdapter - SSH remote command execution adapter
 *
 * Executes commands on remote hosts via SSH.
 * Used for volume control and other system commands on external devices.
 *
 * @module adapters/home-automation/remote-exec
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

const execAsync = promisify(exec);

/**
 * @typedef {Object} ExecResult
 * @property {boolean} ok - Whether command succeeded
 * @property {string[]} [output] - Command output lines
 * @property {string} [error] - Error message if failed
 * @property {number} elapsedMs - Time taken
 */

export class RemoteExecAdapter {
  #host;
  #user;
  #port;
  #privateKey;
  #knownHostsPath;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.host - Remote host
   * @param {string} config.user - SSH user
   * @param {number} [config.port=22] - SSH port
   * @param {string} config.privateKey - Path to SSH private key
   * @param {string} [config.knownHostsPath] - Path to known_hosts file
   * @param {Object} [deps]
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    this.#host = config.host;
    this.#user = config.user;
    this.#port = config.port || 22;
    this.#privateKey = config.privateKey;
    this.#knownHostsPath = config.knownHostsPath;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      commandsExecuted: 0,
      commandsSucceeded: 0,
      commandsFailed: 0,
      lastCommandAt: null
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Execute a command on the remote host
   * @param {string} command - Command to execute
   * @returns {Promise<ExecResult>}
   */
  async execute(command) {
    const startTime = Date.now();
    this.#metrics.commandsExecuted++;
    this.#metrics.lastCommandAt = nowTs24();

    this.#logger.info?.('remote-exec.execute', { host: this.#host, user: this.#user });

    try {
      // Ensure known_hosts file exists
      const knownHostsInfo = await this.#ensureKnownHosts();

      // Build SSH command
      const sshCommand = this.#buildSshCommand(command, knownHostsInfo);

      // Execute
      const { stdout } = await execAsync(sshCommand);
      const output = stdout.trim().split('\n').filter(Boolean);

      this.#metrics.commandsSucceeded++;
      this.#logger.debug?.('remote-exec.success', {
        host: this.#host,
        outputLines: output.length
      });

      return {
        ok: true,
        output,
        elapsedMs: Date.now() - startTime
      };
    } catch (error) {
      this.#metrics.commandsFailed++;
      this.#logger.error?.('remote-exec.failed', {
        host: this.#host,
        error: error.message
      });

      return {
        ok: false,
        error: error.message,
        elapsedMs: Date.now() - startTime
      };
    }
  }

  /**
   * Set system volume
   * @param {number|string} level - Volume level (0-100), or '+', '-', 'mute', 'unmute'
   * @returns {Promise<ExecResult>}
   */
  async setVolume(level) {
    if (level === 'mute') {
      return this.execute('amixer set Master mute');
    }
    if (level === 'unmute') {
      return this.execute('amixer set Master unmute');
    }
    if (typeof level === 'number' || !isNaN(parseInt(level))) {
      const vol = parseInt(level);
      return this.execute(`amixer set Master ${vol}%`);
    }

    return { ok: false, error: `Invalid volume level: ${level}`, elapsedMs: 0 };
  }

  /**
   * Set audio output device (PipeWire/PulseAudio)
   * @param {string} device - Device name pattern
   * @returns {Promise<ExecResult>}
   */
  async setAudioDevice(device) {
    const cmd = `wpctl set-default $(wpctl status | grep '${device}' | sed 's/.*│[[:space:]]*\\([0-9]*\\)\\..*/\\1/')`;
    return this.execute(cmd);
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.#host && this.#user && this.#privateKey);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    const uptimeMs = Date.now() - this.#metrics.startedAt;
    return {
      provider: 'remote-exec',
      host: this.#host,
      user: this.#user,
      uptime: {
        ms: uptimeMs,
        formatted: this.#formatDuration(uptimeMs)
      },
      commands: {
        executed: this.#metrics.commandsExecuted,
        succeeded: this.#metrics.commandsSucceeded,
        failed: this.#metrics.commandsFailed
      },
      lastCommandAt: this.#metrics.lastCommandAt
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Ensure known_hosts file exists
   * @private
   * @returns {Promise<{path: string, isEmpty: boolean}>}
   */
  async #ensureKnownHosts() {
    let resolvedPath = this.#knownHostsPath || './known_hosts';

    // Always resolve to absolute path
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(process.cwd(), resolvedPath);
    }

    let isEmpty = true;

    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(resolvedPath)) {
        fs.writeFileSync(resolvedPath, '', { mode: 0o600 });
        this.#logger.info?.('remote-exec.knownHostsCreated', { path: resolvedPath });
        isEmpty = true;
      } else {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        isEmpty = !content || content.trim().length === 0;
      }
    } catch (err) {
      this.#logger.error?.('remote-exec.knownHostsError', { error: err.message });
      isEmpty = true;
    }

    return { path: resolvedPath, isEmpty };
  }

  /**
   * Build SSH command string
   * @private
   */
  #buildSshCommand(command, knownHostsInfo) {
    // Base64 encode the command for safe transmission
    const base64Cmd = Buffer.from(command).toString('base64');

    const sshOptions = [
      knownHostsInfo.isEmpty ? '-o StrictHostKeyChecking=no' : '',
      `-o UserKnownHostsFile=${knownHostsInfo.path}`,
      `-i ${this.#privateKey}`,
      `-p ${this.#port}`
    ].filter(Boolean).join(' ');

    return `ssh ${sshOptions} ${this.#user}@${this.#host} "echo ${base64Cmd} | base64 -d | bash"`;
  }

  /**
   * Format duration
   * @private
   */
  #formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default RemoteExecAdapter;
