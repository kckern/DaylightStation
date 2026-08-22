/**
 * LogDispatcher - Central hub for routing log events to transports
 *
 * All log events flow through the dispatcher, which handles level filtering
 * and fans out to registered transports (console, loggly, etc).
 */

import { formatLocalTimestamp } from './localTimestamp.mjs';

/**
 * Current time as local wall-clock WITH its UTC offset, in the configured
 * timezone when one has been set.
 *
 * The offset is not cosmetic: without it VictoriaLogs reads the local clock as
 * UTC and files backend events hours away from the frontend events they belong
 * beside. See `localTimestamp.mjs`.
 *
 * @returns {string} e.g. "2026-08-22T15:00:58.668-07:00"
 */
function getLocalTimestamp() {
  return formatLocalTimestamp(new Date(), globalTimezone);
}

let globalTimezone = null;

export const LEVEL_PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };

export class LogDispatcher {
  constructor(config = {}) {
    this.transports = [];
    this.defaultLevel = config.defaultLevel || 'info';
    this.componentLevels = config.componentLevels || {};
    this.metrics = { sent: 0, dropped: 0, errors: 0 };
    
    // Set global timezone for timestamp formatting
    if (config.timezone) {
      globalTimezone = config.timezone;
    }
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
   */
  removeTransport(name) {
    this.transports = this.transports.filter(t => t.name !== name);
  }

  /**
   * Dispatch a log event to all transports
   */
  dispatch(event) {
    if (!this.isLevelEnabled(event.level, event.context)) {
      this.metrics.dropped++;
      return;
    }

    const validated = this.validate(event);
    if (!validated) {
      this.metrics.dropped++;
      return;
    }

    this.metrics.sent++;
    for (const transport of this.transports) {
      try {
        transport.send(validated);
      } catch (err) {
        this.metrics.errors++;
        process.stderr.write(
          `[LogDispatcher] Transport "${transport.name}" failed: ${err.message}\n`
        );
      }
    }
  }

  /**
   * Check if a log level should be processed
   */
  isLevelEnabled(level, context = {}) {
    const componentLevel = context?.source ? this.componentLevels[context.source] : null;
    const effectiveLevel = componentLevel || this.defaultLevel;
    const currentPriority = LEVEL_PRIORITY[effectiveLevel] ?? LEVEL_PRIORITY.info;
    const eventPriority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
    return eventPriority >= currentPriority;
  }

  /**
   * Validate and normalize event structure
   */
  validate(event) {
    if (!event?.event || typeof event.event !== 'string') {
      return null;
    }
    return {
      ts: event.ts || getLocalTimestamp(),
      level: event.level || 'info',
      event: event.event,
      message: event.message,
      data: event.data || {},
      context: event.context || {},
      tags: event.tags || []
    };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getTransportNames() {
    return this.transports.map(t => t.name);
  }

  async flush() {
    await Promise.all(
      this.transports
        .filter(t => typeof t.flush === 'function')
        .map(t => t.flush().catch(err => {
          process.stderr.write(`[LogDispatcher] Flush failed for "${t.name}": ${err.message}\n`);
        }))
    );
  }

  setLevel(level) {
    if (LEVEL_PRIORITY[level] !== undefined) {
      this.defaultLevel = level;
    }
  }
}

// Singleton instance
let dispatcher = null;

export function getDispatcher() {
  if (!dispatcher) {
    throw new Error('LogDispatcher not initialized. Call initializeLogging() first.');
  }
  return dispatcher;
}

export function isLoggingInitialized() {
  return dispatcher !== null;
}

export function initializeLogging(config = {}) {
  dispatcher = new LogDispatcher(config);
  return dispatcher;
}

export function resetLogging() {
  if (dispatcher) {
    dispatcher.flush().catch(() => {});
  }
  dispatcher = null;
}

export default getDispatcher;
