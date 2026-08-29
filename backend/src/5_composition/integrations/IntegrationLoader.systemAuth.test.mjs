import { describe, expect, it, vi } from 'vitest';
import { IntegrationLoader } from './IntegrationLoader.mjs';

describe('IntegrationLoader system provider credentials', () => {
  it('loads OpenAI with the canonical system auth api_key', async () => {
    const Adapter = vi.fn(function Adapter(config) {
      this.apiKey = config.apiKey;
      this.isConfigured = () => Boolean(this.apiKey);
    });
    const registry = {
      getManifest: vi.fn(() => ({ adapter: async () => ({ default: Adapter }) })),
    };
    const configService = {
      getIntegrationsConfig: () => ({ openai: {} }),
      getHouseholdAuth: () => null,
      getSystemAuth: (provider, key) => provider === 'openai' && key === 'api_key' ? 'system-key' : null,
      getSecret: () => null,
      resolveServiceUrl: () => null,
    };

    const adapters = await new IntegrationLoader({ registry, configService, logger: {} })
      .loadForHousehold('default');

    expect(adapters.has('ai')).toBe(true);
    expect(adapters.get('ai').apiKey).toBe('system-key');
  });
});
