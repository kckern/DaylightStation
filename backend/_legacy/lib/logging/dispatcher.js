/**
 * LogDispatcher - Central hub for routing log events to transports
 * 
 * All log events flow through the dispatcher, which handles level filtering 
 * and fans out to registered transports (console, loggly, etc).
 */

const LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };

class LogDispatcher {
  constructor(config = {}) {
    this.transports = [];
    this.defaultLevel = config.defaultLevel || 'info';
    this.componentLevels = config.componentLevels || {}; // Per-component log levels
    this.metrics = { sent: 0, dropped: 0, errors: 0 };
  }

  /**
   * Register a transport
   * @param {Object} transport - Must implement { name: string, send(event): void, flush?(): Promise }
   */
  addTransport(transport) {
    if (!transport.name || typeof transport.send !== 'function') {
      throw new Error('Invalid transport: must have name and send()');
    }
    this.transports.push(transport);
  }

  /**
   * Remove a transport by name
   * @param {string} name - Transport name to remove
   */
  removeTransport(name) {
    this.transports = this.transports.filter(t => t.name !== name);
  }

  /**
   * Dispatch a log event to all transports
   * @param {Object} event - Normalized log event
   */
  dispatch(event) {
    // Level filtering (check component-specific level if available)
    if (!this.isLevelEnabled(event.level, event.context)) {
      this.metrics.dropped++;
      return;
    }

    // Validate and normalize event structure
    const validated = this.validate(event);
    if (!validated) {
      this.metrics.dropped++;
      return;
    }

    // Fan out to transports
    this.metrics.sent++;
    for (const transport of this.transports) {
      try {
        transport.send(validated);
      } catch (err) {
        this.metrics.errors++;
        // Log transport failure to stderr (avoid recursion)
        process.stderr.write(
          `[LogDispatcher] Transport "${transport.name}" failed: ${err.message}\n`
        );
      }
    }
  }

  /**
   * Check if a log level should be processed
   * @param {string} level - Log level to check
   * @param {Object} context - Event context (contains source/component info)
   * @returns {boolean}
   */
  isLevelEnabled(level, context = {}) {
    // Check for component-specific level first (based on context.source)
    const componentLevel = context?.source ? this.componentLevels[context.source] : null;
    const effectiveLevel = componentLevel || this.defaultLevel;

    const currentPriority = LEVEL_PRIORITY[effectiveLevel] ?? LEVEL_PRIORITY.info;
    const eventPriority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
    return eventPriority >= currentPriority;
  }

  /**
   * Validate and normalize event structure
   * @param {Object} event - Raw event
   * @returns {Object|null} - Normalized event or null if invalid
   */
  validate(event) {
    if (!event?.event || typeof event.event !== 'string') {
      return null;
    }
    return {
      ts: event.ts || new Date().toISOString(),
      level: event.level || 'info',
      event: event.event,
      message: event.message,
      data: event.data || {},
      context: event.context || {},
      tags: event.tags || []
    };
  }

  /**
   * Get current metrics
   * @returns {Object} - { sent, dropped, errors }
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get list of transport names
   * @returns {string[]}
   */
  getTransportNames() {
    return this.transports.map(t => t.name);
  }

  /**
   * Flush all transports that support flushing
   * @returns {Promise<void>}
   */
  async flush() {
    await Promise.all(
      this.transports
        .filter(t => typeof t.flush === 'function')
        .map(t => t.flush().catch(err => {
          process.stderr.write(`[LogDispatcher] Flush failed for "${t.name}": ${err.message}\n`);
        }))
    );
  }

  /**
   * Set the default log level
   * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
   */
  setLevel(level) {
    if (LEVEL_PRIORITY[level] !== undefined) {
      this.defaultLevel = level;
    }
  }
}

// Singleton instance
let dispatcher = null;

/**
 * Get the global dispatcher instance
 * @returns {LogDispatcher}
 * @throws {Error} if not initialized
 */
export function getDispatcher() {
  if (!dispatcher) {
    throw new Error('LogDispatcher not initialized. Call initializeLogging() first.');
  }
  return dispatcher;
}

/**
 * Check if dispatcher is initialized
 * @returns {boolean}
 */
export function isLoggingInitialized() {
  return dispatcher !== null;
}

/**
 * Initialize the global logging dispatcher
 * @param {Object} config - { defaultLevel?: string, componentLevels?: Object }
 * @returns {LogDispatcher}
 */
export function initializeLogging(config = {}) {
  dispatcher = new LogDispatcher(config);
  return dispatcher;
}

/**
 * Reset the dispatcher (primarily for testing)
 */
export function resetLogging() {
  if (dispatcher) {
    dispatcher.flush().catch(() => {});
  }
  dispatcher = null;
}

export { LogDispatcher, LEVEL_PRIORITY };
export default getDispatcher;
