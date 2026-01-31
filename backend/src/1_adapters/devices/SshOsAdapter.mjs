/**
 * SshOsAdapter - OS control via SSH commands
 *
 * Implements IOsControl port using SSH for remote command execution.
 * Handles volume control, audio device switching, and arbitrary commands.
 *
 * @module adapters/devices
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class SshOsAdapter {
  #host;
  #user;
  #port;
  #commands;
  #remoteExec;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.host - SSH host
   * @param {string} config.user - SSH user
   * @param {number} [config.port=22] - SSH port
   * @param {Object} config.commands - Command templates
   * @param {string} [config.commands.volume] - Volume command template
   * @param {string} [config.commands.mute] - Mute command
   * @param {string} [config.commands.unmute] - Unmute command
   * @param {Object} [config.audio_devices] - Audio device name mappings
   * @param {Object} deps
   * @param {Object} deps.remoteExec - Remote execution service
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!deps.remoteExec) {
      throw new InfrastructureError('SshOsAdapter requires remoteExec', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'remoteExec'
      });
    }

    this.#host = config.host;
    this.#user = config.user;
    this.#port = config.port || 22;
    this.#commands = config.commands || {};
    this.#remoteExec = deps.remoteExec;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      commands: 0,
      errors: 0
    };
  }

  // =============================================================================
  // IOsControl Implementation
  // =============================================================================

  /**
   * Execute a command on the remote host
   * @param {string} command - Command to execute
   * @returns {Promise<Object>}
   */
  async execute(command) {
    this.#metrics.commands++;

    try {
      this.#logger.debug?.('ssh.execute', { host: this.#host, command });

      const result = await this.#remoteExec.execute(command, {
        host: this.#host,
        user: this.#user,
        port: this.#port
      });

      return {
        ok: result.ok !== false,
        command,
        output: result.output || result.stdout,
        error: result.error
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('ssh.execute.error', { command, error: error.message });
      return {
        ok: false,
        command,
        error: error.message
      };
    }
  }

  /**
   * Set volume level
   * @param {number|string} level - Volume level (0-100, 'mute', 'unmute')
   * @returns {Promise<Object>}
   */
  async setVolume(level) {
    let command;

    if (level === 'mute') {
      command = this.#commands.mute;
    } else if (level === 'unmute') {
      command = this.#commands.unmute;
    } else {
      command = this.#commands.volume?.replace('{level}', String(level));
    }

    if (!command) {
      return { ok: false, error: `No command configured for volume level: ${level}` };
    }

    this.#logger.info?.('ssh.setVolume', { level, command });
    return this.execute(command);
  }

  /**
   * Set audio output device
   * @param {string} deviceName - Device name or alias
   * @returns {Promise<Object>}
   */
  async setAudioDevice(deviceName) {
    const command = this.#commands.audio_device?.replace('{device}', deviceName);

    if (!command) {
      return { ok: false, error: 'No audio device command configured' };
    }

    this.#logger.info?.('ssh.setAudioDevice', { deviceName, command });
    return this.execute(command);
  }

  /**
   * Check if this adapter provides volume control
   * @returns {boolean}
   */
  hasVolumeControl() {
    return !!(this.#commands.volume || this.#commands.mute);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: 'ssh',
      host: this.#host,
      uptime: Date.now() - this.#metrics.startedAt,
      commands: this.#metrics.commands,
      errors: this.#metrics.errors
    };
  }
}

export default SshOsAdapter;
