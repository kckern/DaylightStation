// tests/unit/suite/adapters/content/media/plex/manifest.test.mjs
import manifest from '#adapters/content/media/plex/manifest.mjs';

describe('Plex Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('plex');
    expect(manifest.capability).toBe('media');
    expect(manifest.displayName).toBe('Plex Media Server');
  });

  test('adapter factory returns PlexAdapter class', async () => {
    const { PlexAdapter: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('PlexAdapter');
  });

  test('has config schema with required fields', () => {
    expect(manifest.configSchema.host.required).toBe(true);
    expect(manifest.configSchema.port.default).toBe(32400);
    expect(manifest.configSchema.token.secret).toBe(true);
  });
});
