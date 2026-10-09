export class AgentConfigProjection {
  constructor({ configService }) { this.configService = configService; }
  settings(agentId) {
    let raw = null; try { raw = this.configService?.getAppConfig?.('agents') ?? null; } catch {}
    return { defaults: raw?.default || {}, override: raw?.overrides?.[agentId] || {} };
  }
}
