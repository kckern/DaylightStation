// tests/integration/suite/bootstrap/adapter-discovery.test.mjs
import { AdapterRegistry } from '#backend/src/0_system/registries/AdapterRegistry.mjs';

describe('Adapter Discovery Integration', () => {
  test('discovers all manifests in adapters directory', async () => {
    const registry = new AdapterRegistry();
    await registry.discover();

    // Verify expected adapters were discovered
    expect(registry.getProviders('media')).toContain('plex');
    expect(registry.getProviders('media')).toContain('filesystem');
    expect(registry.getProviders('ai')).toContain('openai');
    expect(registry.getProviders('ai')).toContain('anthropic');
    expect(registry.getProviders('home_automation')).toContain('home_assistant');
  });

  test('can load adapter from manifest', async () => {
    const registry = new AdapterRegistry();
    await registry.discover();

    const manifest = registry.getManifest('media', 'plex');
    // Adapters use named exports: { PlexAdapter }
    const module = await manifest.adapter();
    const AdapterClass = module.PlexAdapter || module.default;

    expect(AdapterClass.name).toBe('PlexAdapter');
  });

  test('manifests have required fields', async () => {
    const registry = new AdapterRegistry();
    await registry.discover();

    for (const capability of registry.getAllCapabilities()) {
      for (const provider of registry.getProviders(capability)) {
        const manifest = registry.getManifest(capability, provider);
        expect(manifest.provider).toBe(provider);
        expect(manifest.capability).toBe(capability);
        expect(typeof manifest.adapter).toBe('function');
        expect(manifest.displayName).toBeDefined();
      }
    }
  });
});
