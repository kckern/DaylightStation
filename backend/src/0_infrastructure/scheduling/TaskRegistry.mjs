/**
 * TaskRegistry - Manages scheduled tasks/cron jobs
 */

export class TaskRegistry {
  constructor() {
    this.tasks = new Map();
    this.running = new Map();
  }

  /**
   * Register a task
   * @param {string} name - Task name
   * @param {Object} config - Task configuration
   * @param {string} config.schedule - Cron expression
   * @param {Function} config.handler - Task handler function
   * @param {boolean} [config.enabled=true] - Whether task is enabled
   */
  register(name, config) {
    if (!name || !config.handler) {
      throw new Error('Task requires name and handler');
    }
    this.tasks.set(name, {
      name,
      schedule: config.schedule,
      handler: config.handler,
      enabled: config.enabled !== false,
      lastRun: null,
      lastError: null,
      runCount: 0
    });
  }

  /**
   * Unregister a task
   */
  unregister(name) {
    this.tasks.delete(name);
  }

  /**
   * Get all registered tasks
   */
  getAll() {
    return Array.from(this.tasks.values());
  }

  /**
   * Get a specific task
   */
  get(name) {
    return this.tasks.get(name) ?? null;
  }

  /**
   * Execute a task by name
   */
  async execute(name) {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Task not found: ${name}`);
    }
    if (!task.enabled) {
      throw new Error(`Task disabled: ${name}`);
    }
    if (this.running.has(name)) {
      throw new Error(`Task already running: ${name}`);
    }

    this.running.set(name, Date.now());

    try {
      await task.handler();
      task.lastRun = nowTs24();
      task.lastError = null;
      task.runCount++;
    } catch (err) {
      task.lastError = err.message;
      throw err;
    } finally {
      this.running.delete(name);
    }
  }

  /**
   * Enable/disable a task
   */
  setEnabled(name, enabled) {
    const task = this.tasks.get(name);
    if (task) {
      task.enabled = enabled;
    }
  }

  /**
   * Check if a task is running
   */
  isRunning(name) {
    return this.running.has(name);
  }

  /**
   * Get task status
   */
  getStatus(name) {
    const task = this.tasks.get(name);
    if (!task) return null;
    return {
      name: task.name,
      enabled: task.enabled,
      running: this.running.has(name),
      lastRun: task.lastRun,
      lastError: task.lastError,
      runCount: task.runCount
    };
  }
}

export default TaskRegistry;
