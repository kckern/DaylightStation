import { describe, it, expect, vi } from 'vitest';
import { IntegrationLoader } from './IntegrationLoader.mjs';

describe('IntegrationLoader decorateAdapter hook', () => {
  it('passes each loaded adapter through decorateAdapter and never hands the hook to the adapter', async () => {
    const Adapter = vi.fn(function Adapter(config, deps) { this.deps = deps; this.isConfigured = () => true; });
    const registry = { getManifest: vi.fn(() => ({ adapter: async () => ({ default: Adapter }) })) };
    const configService = {
      getIntegrationsConfig: () => ({ openai: {} }), getHouseholdAuth: () => null,
      getSystemAuth: () => 'k', getSecret: () => null, resolveServiceUrl: () => null,
    };
    const decorateAdapter = vi.fn((capability, adapter) => (capability === 'ai' ? { wrapped: adapter, isConfigured: () => true } : adapter));
    const adapters = await new IntegrationLoader({ registry, configService, logger: {} })
      .loadForHousehold('default', { decorateAdapter });
    expect(decorateAdapter).toHaveBeenCalledWith('ai', expect.any(Adapter), expect.any(Object));
    expect(adapters.get('ai').wrapped).toBeInstanceOf(Adapter);
    expect(adapters.get('ai').wrapped.deps.decorateAdapter).toBeUndefined();
  });
});
