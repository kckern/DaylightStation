/** Shared single-process lock; acquire series before any activity lock. */
export class AgendaWriteLanes {
  #tails = new Map();
  async withSeriesLane(key, fn) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#tails.set(key, tail);
    await previous;
    try { return await fn(); } finally { release(); if (this.#tails.get(key) === tail) this.#tails.delete(key); }
  }
}
