/**
 * ActionBus - Central event bus for screen framework
 *
 * Input adapters emit actions, widgets subscribe to actions they handle.
 * Supports wildcard subscriptions for logging/debugging.
 */
export class ActionBus {
  constructor() {
    this.subscribers = new Map();
    this.wildcardSubscribers = new Set();
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

  /**
   * Emit an action to all subscribers
   * @param {string} action - Action name
   * @param {*} payload - Action payload
   */
  emit(action, payload) {
    // Notify specific subscribers
    const handlers = this.subscribers.get(action);
    if (handlers) {
      handlers.forEach(handler => handler(payload));
    }

    // Notify wildcard subscribers
    this.wildcardSubscribers.forEach(handler => handler(action, payload));
  }

  /**
   * Clear all subscribers (useful for testing/cleanup)
   */
  clear() {
    this.subscribers.clear();
    this.wildcardSubscribers.clear();
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
