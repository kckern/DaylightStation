/**
 * TaskerAdapter - Android Tasker control adapter
 *
 * Provides control over Android devices running Tasker with AutoRemote plugin.
 * Sends HTTP commands that trigger Tasker tasks.
 *
 * @module adapters/home-automation/tasker
 */

/**
 * @typedef {Object} TaskerCommandResult
 * @property {boolean} ok - Whether command succeeded
 * @property {string} command - Command that was sent
 * @property {number} elapsedMs - Time taken
 * @property {number} [attempts] - Number of attempts made
 * @property {string} [error] - Error message if failed
 */

export class TaskerAdapter {
  #host;
  #port;
  #logger;
  #httpClient;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.host - Android device IP or hostname
   * @param {number} config.port - Tasker HTTP server port
   * @param {Object} [deps]
   * @param {Object} [deps.logger] - Logger instance
   * @param {Object} [deps.httpClient] - HTTP client (defaults to fetch)
   */
  constructor(config, deps = {}) {
    this.#host = config.host;
    this.#port = config.port;
    this.#logger = deps.logger || console;
    this.#httpClient = deps.httpClient || null;

    this.#metrics = {
      startedAt: Date.now(),
      commandsSent: 0,
      commandsSucceeded: 0,
      commandsFailed: 0,
      lastCommandAt: null
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Send a command to Tasker
   * @param {string} command - Command/task name to trigger
   * @param {Object} [options]
   * @param {number} [options.maxRetries=10] - Max retries on failure
   * @param {number} [options.retryDelayMs=1000] - Delay between retries
   * @returns {Promise<TaskerCommandResult>}
   */
  async sendCommand(command, options = {}) {
    const maxRetries = options.maxRetries ?? 10;
    const retryDelayMs = options.retryDelayMs ?? 1000;

    return this.#sendCommandWithRetry(command, maxRetries, retryDelayMs, 1, Date.now());
  }

  /**
   * Send blank screen command (commonly used)
   * @returns {Promise<TaskerCommandResult>}
   */
  async showBlank() {
    return this.sendCommand('blank');
  }

  /**
   * Send screen on command
   * @returns {Promise<TaskerCommandResult>}
   */
  async screenOn() {
    return this.sendCommand('screenon');
  }

  /**
   * Send screen off command
   * @returns {Promise<TaskerCommandResult>}
   */
  async screenOff() {
    return this.sendCommand('screenoff');
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.#host && this.#port);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    const uptimeMs = Date.now() - this.#metrics.startedAt;
    return {
      provider: 'tasker',
      host: this.#host,
      port: this.#port,
      uptime: {
        ms: uptimeMs,
        formatted: this.#formatDuration(uptimeMs)
      },
      commands: {
        sent: this.#metrics.commandsSent,
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
   * Send command with retry logic
   * @private
   */
  async #sendCommandWithRetry(command, maxRetries, retryDelayMs, attempt, startTime) {
    if (attempt > maxRetries) {
      this.#metrics.commandsFailed++;
      return {
        ok: false,
        command,
        elapsedMs: Date.now() - startTime,
        attempts: attempt - 1,
        error: `Failed after ${maxRetries} attempts`
      };
    }

    this.#metrics.commandsSent++;
    this.#metrics.lastCommandAt = new Date().toISOString();

    try {
      const url = `http://${this.#host}:${this.#port}/${command}`;
      const response = await this.#fetch(url);
      const text = await response.text();

      // Tasker responds with "OK" on success
      const isOK = /OK/i.test(text);

      if (isOK) {
        this.#metrics.commandsSucceeded++;
        this.#logger.info?.('tasker.command.success', {
          command,
          attempt,
          elapsedMs: Date.now() - startTime
        });

        return {
          ok: true,
          command,
          elapsedMs: Date.now() - startTime,
          attempts: attempt
        };
      }

      // Retry on non-OK response
      this.#logger.debug?.('tasker.command.retry', { command, attempt, response: text });
      await this.#sleep(retryDelayMs);
      return this.#sendCommandWithRetry(command, maxRetries, retryDelayMs, attempt + 1, startTime);
    } catch (error) {
      this.#logger.debug?.('tasker.command.error', {
        command,
        attempt,
        error: error.message
      });

      await this.#sleep(retryDelayMs);
      return this.#sendCommandWithRetry(command, maxRetries, retryDelayMs, attempt + 1, startTime);
    }
  }

  /**
   * Fetch wrapper
   * @private
   */
  async #fetch(url) {
    if (this.#httpClient) {
      return this.#httpClient.get(url);
    }
    return fetch(url);
  }

  /**
   * Sleep helper
   * @private
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

export default TaskerAdapter;
