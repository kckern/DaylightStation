export class EffectPolicyRunner {
  constructor({ policies = [], onFailure = () => {} } = {}) { this.policies = policies; this.onFailure = onFailure; this.latest = new Map(); }
  async react(event, context = {}) {
    await Promise.all(this.policies.filter((policy) => policy.matches(event, context)).map(async (policy) => {
      const key = policy.newestWinsKey?.(event, context) || null; const token = Symbol(policy.id);
      if (key) this.latest.set(key, token);
      try {
        const result = await policy.run(event, context);
        if (key && this.latest.get(key) !== token) return null;
        return result;
      } catch (error) { this.onFailure({ policy: policy.id, error, event }); return null; }
    }));
  }
}
