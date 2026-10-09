export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
  }

  register(name, component, meta = null) {
    this.widgets.set(name, { component, meta });
  }

  has(name) {
    return this.widgets.has(name);
  }

  get(name) {
    const entry = this.widgets.get(name);
    return entry ? entry.component : null;
  }

  getMeta(name) {
    const entry = this.widgets.get(name);
    return entry ? entry.meta : null;
  }

  list(namespace) {
    const keys = Array.from(this.widgets.keys());
    if (!namespace) return keys;
    const prefix = namespace + ':';
    return keys.filter(k => k.startsWith(prefix));
  }

  clear() {
    this.widgets.clear();
  }
}
