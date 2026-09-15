/**
 * ActionBus - Central event bus for screen framework
 *
 * Input adapters emit actions, widgets subscribe to actions they handle.
 * Supports wildcard subscriptions for logging/debugging.
 */
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ActionBus' });
  return _logger;
}

export class ActionBus {
  constructor() {
    this.subscribers = new Map();
    this.wildcardSubscribers = new Set();
    this.captures = new Set();
  }

  /**
   * Subscribe to an action type
   * @param {string} action - Action name or '*' for all actions
   * @param {Function} handler - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(action, handler) {
    if (action === '*') {
      this.wildcardSubscribers.add(handler);
      return () => this.wildcardSubscribers.delete(handler);
    }

    if (!this.subscribers.has(action)) {
      this.subscribers.set(action, new Set());
    }
    this.subscribers.get(action).add(handler);

    return () => {
      const handlers = this.subscribers.get(action);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /** Give an active modal first ownership of selected semantic actions.
   * Newest owner runs first. Return true to consume; observers still see it.
   */
  capture(actions, handler) {
    const entry = { actions: new Set(actions), handler };
    this.captures.add(entry);
    return () => this.captures.delete(entry);
  }

  /**
   * Emit an action, returning whether a capture owner consumed it.
   * @param {string} action - Action name
   * @param {*} payload - Action payload
   */
  emit(action, payload) {
    const consumed = [...this.captures].reverse().some(entry => entry.actions.has(action) && entry.handler(action, payload) === true);
    const handlers = this.subscribers.get(action);
    const subscriberCount = handlers ? handlers.size : 0;

    if (consumed) {
      logger().debug('actionbus.emit.captured', { action });
    } else if (subscriberCount === 0) {
      logger().warn('actionbus.emit.unhandled', { action, subscriberCount: 0 });
    } else {
      logger().debug('actionbus.emit', { action, subscriberCount });
      handlers.forEach(handler => handler(payload));
    }

    // Notify wildcard subscribers
    this.wildcardSubscribers.forEach(handler => handler(action, payload));
    return consumed;
  }

  /**
   * Clear all subscribers (useful for testing/cleanup)
   */
  clear() {
    this.subscribers.clear();
    this.wildcardSubscribers.clear();
    this.captures.clear();
  }
}

// Singleton instance for app-wide use
let defaultBus = null;

export function getActionBus() {
  if (!defaultBus) {
    defaultBus = new ActionBus();
  }
  return defaultBus;
}

export function resetActionBus() {
  defaultBus = null;
}
