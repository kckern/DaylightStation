// tests/integration/suite/bootstrap/adapter-discovery.test.mjs
import { AdapterRegistry } from '#composition/integrations/AdapterRegistry.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Jest transforms ESM test modules, so import.meta is not a stable way to
// locate repository fixtures here. Integrated tests always run from repo root.
const adaptersRoot = path.resolve(process.cwd(), 'backend/src/1_adapters');
const execFileAsync = promisify(execFile);

describe('Adapter Discovery Integration', () => {
  test('discovers all manifests in adapters directory', async () => {
    const registry = new AdapterRegistry({ adaptersRoot });
    await registry.discover();

    // Verify expected adapters were discovered
    expect(registry.getProviders('media')).toContain('plex');
    expect(registry.getProviders('media')).toContain('files');
    expect(registry.getProviders('ai')).toContain('openai');
    expect(registry.getProviders('ai')).toContain('anthropic');
    expect(registry.getProviders('home_automation')).toContain('homeassistant');
  });

  test('can load adapter from manifest', async () => {
    // Exercise the manifest's production ESM loader in Node itself. Jest's
    // transform rewrites import.meta inside Plex modules to CommonJS require,
    // which is a test-runner artifact rather than an adapter loading failure.
    const script = `
      const { AdapterRegistry } = await import('./backend/src/5_composition/integrations/AdapterRegistry.mjs');
      const registry = new AdapterRegistry({ adaptersRoot: ${JSON.stringify(adaptersRoot)} });
      await registry.discover();
      const manifest = registry.getManifest('media', 'plex');
      const module = await manifest.adapter();
      process.stdout.write((module.PlexAdapter || module.default).name);
    `;
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
    });

    expect(stdout).toBe('PlexAdapter');
  });

  test('manifests have required fields', async () => {
    const registry = new AdapterRegistry({ adaptersRoot });
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
