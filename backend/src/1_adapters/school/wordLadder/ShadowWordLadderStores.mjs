import crypto from 'node:crypto';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Test mode's stores (spec §8 Test mode): an in-memory deep copy of one
 * learner's real status + day, snapshotted at open. Nothing here can reach
 * disk — the real store is only ever READ.
 */
export class ShadowWordLadderStores {
  #real; #ttlMs; #max; #now; #shadows = new Map();
  constructor({ real, ttlMs = 3 * 3600000, max = 20, now = Date.now } = {}) {
    if (typeof real?.readStatus !== 'function' || typeof real?.readDay !== 'function') throw new Error('ShadowWordLadderStores requires a real store to read');
    this.#real = real; this.#ttlMs = ttlMs; this.#max = max; this.#now = now;
  }
  #sweep() {
    const t = this.#now();
    for (const [token, shadow] of this.#shadows) if (t - shadow.createdAt > this.#ttlMs) this.#shadows.delete(token);
    while (this.#shadows.size >= this.#max) this.#shadows.delete(this.#shadows.keys().next().value);
  }
  create(userId, pkg, day, seed = null) {
    this.#sweep();
    const token = crypto.randomBytes(6).toString('hex');
    let snapshot = { status: this.#real.readStatus(userId, pkg), dayFile: this.#real.readDay(userId, pkg, day) };
    if (typeof seed === 'function') snapshot = seed(structuredClone(snapshot));
    this.#shadows.set(token, { createdAt: this.#now(), status: snapshot.status, days: { [day]: snapshot.dayFile } });
    return token;
  }
  forToken(token) {
    const shadow = this.#shadows.get(token);
    if (!shadow || this.#now() - shadow.createdAt > this.#ttlMs) {
      this.#shadows.delete(token);
      throw new EntityNotFoundError('test sitting', token);
    }
    return {
      readStatus: () => structuredClone(shadow.status),
      readDay: (_u, _p, day) => structuredClone(shadow.days[day] ?? this.#real.readDay(_u, _p, day)),
      transact: (_u, _p, day, fn) => {
        const next = fn({ status: structuredClone(shadow.status), dayFile: structuredClone(shadow.days[day] ?? this.#real.readDay(_u, _p, day)) });
        shadow.status = next.status; shadow.days[day] = next.dayFile;
        return structuredClone(next);
      },
    };
  }
}
export default ShadowWordLadderStores;
