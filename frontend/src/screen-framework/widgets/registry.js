export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
  }

  register(name, component) {
    this.widgets.set(name, component);
  }

  has(name) {
    return this.widgets.has(name);
  }

  get(name) {
    return this.widgets.get(name) || null;
  }

  list() {
    return Array.from(this.widgets.keys());
  }

  clear() {
    this.widgets.clear();
  }
}

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
