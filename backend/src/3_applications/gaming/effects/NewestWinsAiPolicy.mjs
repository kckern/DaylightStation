export class NewestWinsAiPolicy {
  constructor({ aiGateway, timeoutMs = 1500, clock = { setTimeout, clearTimeout } }) { Object.assign(this, { aiGateway, timeoutMs, clock }); this.latest = new Map(); }
  async propose(key, request) {
    const token = Symbol(key); this.latest.set(key, token);
    let timer; try {
      const invoke = typeof this.aiGateway.complete === 'function'
        ? this.aiGateway.complete(request)
        : this.aiGateway.chat(request.messages || request, request.options || {});
      const response = await Promise.race([invoke, new Promise((resolve) => { timer = this.clock.setTimeout(() => resolve(null), this.timeoutMs); })]);
      return this.latest.get(key) === token ? response : null;
    } catch { return null; }
    finally { if (timer) this.clock.clearTimeout(timer); }
  }
}
