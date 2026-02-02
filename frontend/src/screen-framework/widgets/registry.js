/**
 * WidgetRegistry - Central registry for screen framework widgets
 *
 * Built-in widgets are auto-registered at startup.
 * Custom widgets can be registered via config.
 */
export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
    this.metadata = new Map();
  }

  /**
   * Register a widget component
   * @param {string} name - Widget identifier
   * @param {React.Component} component - React component
   * @param {Object} meta - Widget metadata (defaultSource, refreshInterval, actions)
   */
  register(name, component, meta = {}) {
    this.widgets.set(name, component);
    this.metadata.set(name, {
      defaultSource: null,
      refreshInterval: null,
      actions: [],
      ...meta
    });
  }

  /**
   * Check if a widget is registered
   * @param {string} name - Widget identifier
   * @returns {boolean}
   */
  has(name) {
    return this.widgets.has(name);
  }

  /**
   * Get a widget component
   * @param {string} name - Widget identifier
   * @returns {React.Component|null}
   */
  get(name) {
    return this.widgets.get(name) || null;
  }

  /**
   * Get widget metadata
   * @param {string} name - Widget identifier
   * @returns {Object|null}
   */
  getMetadata(name) {
    return this.metadata.get(name) || null;
  }

  /**
   * List all registered widget names
   * @returns {string[]}
   */
  list() {
    return Array.from(this.widgets.keys());
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear() {
    this.widgets.clear();
    this.metadata.clear();
  }
}

// Singleton instance
let defaultRegistry = null;

export function getWidgetRegistry() {
  if (!defaultRegistry) {
    defaultRegistry = new WidgetRegistry();
  }
  return defaultRegistry;
}

export function resetWidgetRegistry() {
  defaultRegistry = null;
}
