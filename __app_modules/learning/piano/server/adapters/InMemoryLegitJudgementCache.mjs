/**
 * InMemoryLegitJudgementCache — the check-in burst judge's answers, kept in memory
 * (bounded, 6 h TTL). Keys are strings or plain objects (stable-stringified),
 * e.g. { userId, sittingId, kind: 'end-of-lesson' } for the progress store.
 * Lost on restart by design: an end-of-lesson answer that is gone simply
 * leaves the arithmetic score in charge.
 */
function keyOf(key) {
  if (typeof key === 'string') return key;
  if (!key || typeof key !== 'object') return String(key);
  return JSON.stringify(Object.keys(key).sort().map((k) => [k, key[k]]));
}

export class InMemoryLegitJudgementCache {
  #map = new Map();
  #max;
  #ttl;
  #now;

  constructor({ maxEntries = 500, ttlMs = 6 * 3600 * 1000, now = () => Date.now() } = {}) {
    this.#max = maxEntries;
    this.#ttl = ttlMs;
    this.#now = now;
  }

  get(key) {
    const k = keyOf(key);
    const hit = this.#map.get(k);
    if (!hit) return null;
    if (this.#now() - hit.at > this.#ttl) { this.#map.delete(k); return null; }
    return hit.value;
  }

  has(key) { return this.get(key) !== null; }

  set(key, value) {
    const k = keyOf(key);
    this.#map.delete(k);
    this.#map.set(k, { value, at: this.#now() });
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value);
    return value;
  }
}

export default InMemoryLegitJudgementCache;
