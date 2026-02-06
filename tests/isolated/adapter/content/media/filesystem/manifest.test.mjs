// tests/unit/suite/adapters/content/media/media/manifest.test.mjs
import manifest from '#adapters/content/media/files/manifest.mjs';

describe('Media Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('files');
    expect(manifest.capability).toBe('media');
    expect(manifest.displayName).toBe('Local Filesystem');
  });

  test('adapter factory returns FileAdapter class', async () => {
    const { FileAdapter: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('FileAdapter');
  });

  test('has config schema with basePath', () => {
    expect(manifest.configSchema.basePath.required).toBe(true);
    expect(manifest.configSchema.basePath.type).toBe('string');
  });

  test('is marked as implicit (always available)', () => {
    expect(manifest.implicit).toBe(true);
  });
});
