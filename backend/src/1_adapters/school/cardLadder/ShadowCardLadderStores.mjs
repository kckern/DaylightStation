import crypto from 'node:crypto';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Test mode's stores (spec §8 Test mode): an in-memory deep copy of one
 * learner's real status + day, snapshotted at open. Nothing here can reach
 * disk — the real store is only ever READ. Tuning is read from the real
 * store (so a test sitting plays with the learner's values) and has no writer.
 */
export class ShadowCardLadderStores {
  #real; #ttlMs; #max; #now; #shadows = new Map();
  constructor({ real, ttlMs = 3 * 3600000, max = 20, now = Date.now } = {}) {
    if (typeof real?.readStatus !== 'function' || typeof real?.readDay !== 'function') throw new Error('ShadowCardLadderStores requires a real store to read');
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
  /**
   * The same seeded snapshot `create` takes, handed back READ-ONLY and never
   * kept: the start card asks what a test sitting would open on without
   * taking a shadow slot (or evicting someone's live test sitting) to do it.
   */
  peek(userId, pkg, day, seed = null) {
    let snapshot = { status: this.#real.readStatus(userId, pkg), dayFile: this.#real.readDay(userId, pkg, day) };
    if (typeof seed === 'function') snapshot = seed(structuredClone(snapshot));
    return {
      readStatus: () => structuredClone(snapshot.status),
      readDay: (_u, _p, d) => structuredClone(d === day ? snapshot.dayFile : this.#real.readDay(_u, _p, d)),
      readTuning: (u, p) => this.#real.readTuning?.(u, p) ?? null,
    };
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
      readTuning: (u, p) => this.#real.readTuning?.(u, p) ?? null,
    };
  }
}
export default ShadowCardLadderStores;
