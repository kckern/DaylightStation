const enumSeverity = ['info', 'warn', 'error'];

const normalizeSeverity = (value = 'info') => {
  const token = String(value || 'info').toLowerCase();
  return enumSeverity.includes(token) ? token : 'info';
};

const cloneEntry = (entry) => ({
  ...entry,
  data: entry?.data && typeof entry.data === 'object'
    ? { ...entry.data }
    : entry?.data ?? null
});

export class EventJournal {
  constructor({ capacity = 200 } = {}) {
    this.capacity = Math.max(20, Number(capacity) || 200);
    this.entries = [];
    this.subscribers = new Set();
    this.sequence = 0;
  }

  log(type, data = {}, options = {}) {
    if (!type) return null;
    const timestamp = Date.now();
    const entry = {
      id: `${timestamp}-${++this.sequence}`,
      type,
      severity: normalizeSeverity(options.severity),
      timestamp,
      correlationId: options.correlationId || null,
      data: data && typeof data === 'object' ? { ...data } : data
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    this.subscribers.forEach((subscriber) => {
      try {
        subscriber(entry);
      } catch (_) {
        // no-op observer errors
      }
    });
    return entry;
  }

  getEntries({ type, limit } = {}) {
    let results = this.entries;
    if (type) {
      const target = String(type).toLowerCase();
      results = results.filter((entry) => String(entry.type).toLowerCase() === target);
    }
    if (Number.isFinite(limit) && limit > 0) {
      return results.slice(-limit).map(cloneEntry);
    }
    return results.map(cloneEntry);
  }

  subscribe(handler) {
    if (typeof handler !== 'function') return () => {};
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  clear() {
    this.entries = [];
  }
}
