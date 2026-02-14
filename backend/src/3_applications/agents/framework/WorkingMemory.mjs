// backend/src/3_applications/agents/framework/WorkingMemory.mjs

export class WorkingMemoryState {
  #entries = new Map(); // key -> { value, createdAt, expiresAt }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, { ttl } = {}) {
    this.#entries.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: ttl != null ? Date.now() + ttl : null,
    });
  }

  remove(key) {
    this.#entries.delete(key);
  }

  getAll() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v.value])
    );
  }

  serialize() {
    this.#pruneExpired();
    if (!this.#entries.size) return '(empty)';

    const persistent = [];
    const expiring = [];

    for (const [key, entry] of this.#entries) {
      const line = `- **${key}**: ${JSON.stringify(entry.value)}`;
      if (entry.expiresAt) expiring.push(line);
      else persistent.push(line);
    }

    const sections = [];
    if (persistent.length) sections.push('### Persistent\n' + persistent.join('\n'));
    if (expiring.length) sections.push('### Expiring\n' + expiring.join('\n'));
    return sections.join('\n\n');
  }

  pruneExpired() {
    this.#pruneExpired();
  }

  #pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt && now >= entry.expiresAt) this.#entries.delete(key);
    }
  }

  toJSON() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v])
    );
  }

  static fromJSON(data) {
    const state = new WorkingMemoryState();
    for (const [key, entry] of Object.entries(data)) {
      state.#entries.set(key, entry);
    }
    return state;
  }
}
