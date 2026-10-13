import { describe, it, expect, vi } from 'vitest';
import { IntegrationLoader } from './IntegrationLoader.mjs';

const Adapter = vi.fn(function Adapter(config, deps) { this.deps = deps; this.isConfigured = () => true; });
const registry = { getManifest: vi.fn(() => ({ adapter: async () => ({ default: Adapter }) })) };
const configService = (integrations = { openai: {} }) => ({
  getIntegrationsConfig: () => integrations, getHouseholdAuth: () => null,
  getSystemAuth: () => 'k', getSecret: () => null, resolveServiceUrl: () => null,
});
// The decorator app.mjs passes: only the ai capability is wrapped.
const appDecorator = (wrap) => (capability, adapter) => (capability === 'ai' ? wrap(adapter) : adapter);

describe('IntegrationLoader decorateAdapter hook', () => {
  it('passes each loaded adapter through decorateAdapter and never hands the hook to the adapter', async () => {
    const decorateAdapter = vi.fn(appDecorator((adapter) => ({ wrapped: adapter, isConfigured: () => true })));
    const adapters = await new IntegrationLoader({ registry, configService: configService(), logger: {} })
      .loadForHousehold('default', { decorateAdapter });
    expect(decorateAdapter).toHaveBeenCalledWith('ai', expect.any(Adapter), expect.any(Object));
    expect(adapters.get('ai').wrapped).toBeInstanceOf(Adapter);
    expect(adapters.get('ai').wrapped.deps.decorateAdapter).toBeUndefined();
  });

  it('a decorator that throws: warns integration.adapter.decorate-failed and keeps the undecorated adapter', async () => {
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const decorateAdapter = vi.fn(() => { throw new Error('wire config broken'); });
    const adapters = await new IntegrationLoader({ registry, configService: configService(), logger })
      .loadForHousehold('default', { decorateAdapter });
    expect(adapters.get('ai')).toBeInstanceOf(Adapter);
    expect(logger.warn).toHaveBeenCalledWith('integration.adapter.decorate-failed', { capability: 'ai', provider: 'openai', error: 'wire config broken' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a non-ai capability passes through the decorator untouched', async () => {
    const wrap = vi.fn((adapter) => ({ wrapped: adapter }));
    const adapters = await new IntegrationLoader({ registry, configService: configService({ plex: {} }), logger: {} })
      .loadForHousehold('default', { decorateAdapter: appDecorator(wrap) });
    expect(adapters.get('media')).toBeInstanceOf(Adapter);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('a decorator returning null falls back to the adapter', async () => {
    const adapters = await new IntegrationLoader({ registry, configService: configService(), logger: {} })
      .loadForHousehold('default', { decorateAdapter: () => null });
    expect(adapters.get('ai')).toBeInstanceOf(Adapter);
  });
});
