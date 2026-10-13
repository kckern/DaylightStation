import crypto from 'node:crypto';

export class InMemoryRequestDeduplicationStore {
  #entries = new Map();
  #cleanupInterval = null;
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  checkAndRemember(parts, { ttlMs, traceId } = {}) {
    if (!this.#cleanupInterval) {
      this.#cleanupInterval = setInterval(() => this.#cleanup(ttlMs), ttlMs / 2);
      this.#cleanupInterval.unref();
    }

    const key = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
    const now = Date.now();
    const previous = this.#entries.get(key);
    if (previous && now - previous.timestamp < ttlMs) {
      return { duplicate: true, key, ageMs: now - previous.timestamp };
    }
    this.#entries.set(key, { timestamp: now, traceId });
    return { duplicate: false, key, ageMs: null };
  }

  clear() {
    this.#entries.clear();
  }

  get size() {
    return this.#entries.size;
  }

  #cleanup(ttlMs) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.#entries) {
      if (now - entry.timestamp > ttlMs) {
        this.#entries.delete(key);
        cleaned += 1;
      }
    }
    if (cleaned > 0) {
      this.#logger.debug?.('idempotency.cleanup', { cleaned, remaining: this.#entries.size });
    }
  }
}
