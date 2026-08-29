export class NewestWinsAiPolicy {
  constructor({ proposalGenerator, timeoutMs = 1500 }) { Object.assign(this, { proposalGenerator, timeoutMs }); this.latest = new Map(); }
  async propose(key, request) {
    const token = Symbol(key); this.latest.set(key, token);
    try {
      const response = await this.proposalGenerator.generate(request, { timeoutMs: this.timeoutMs });
      return this.latest.get(key) === token ? response : null;
    } catch { return null; }
  }
}
