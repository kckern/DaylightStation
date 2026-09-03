/** Small runtime registry used by governance requirements and challenges. */
export class GovernanceTypeRegistry {
  constructor(kind) {
    this.kind = kind;
    this._handlers = new Map();
  }

  register(type, handler) {
    const key = String(type || '').trim().toLowerCase();
    if (!key || !handler || typeof handler !== 'object') {
      throw new TypeError(`${this.kind} registration requires a type and handler`);
    }
    if (this._handlers.has(key)) throw new Error(`${this.kind} type already registered: ${key}`);
    this._handlers.set(key, Object.freeze({ type: key, ...handler }));
    return this;
  }

  get(type) {
    return this._handlers.get(String(type || '').trim().toLowerCase()) || null;
  }

  list() {
    return [...this._handlers.keys()];
  }

  normalize(type, raw, context = {}) {
    const handler = this.get(type);
    return handler?.normalize ? handler.normalize(raw, context) : null;
  }

  eligibility(type, value, context = {}) {
    const handler = this.get(type);
    if (!handler) return { eligible: false, reason: `unknown_${this.kind}_type` };
    return handler.isEligible ? handler.isEligible(value, context) : { eligible: true, reason: null };
  }

  evaluate(type, value, context = {}) {
    const handler = this.get(type);
    if (!handler?.evaluate) return null;
    return handler.evaluate(value, context);
  }
}

export default GovernanceTypeRegistry;
