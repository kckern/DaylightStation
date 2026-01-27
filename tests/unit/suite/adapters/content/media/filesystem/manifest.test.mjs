// tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs
import manifest from '#backend/src/2_adapters/content/media/filesystem/manifest.mjs';

describe('Filesystem Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('filesystem');
    expect(manifest.capability).toBe('media');
    expect(manifest.displayName).toBe('Local Filesystem');
  });

  test('adapter factory returns FilesystemAdapter class', async () => {
    const { FilesystemAdapter: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('FilesystemAdapter');
  });

  test('has config schema with basePath', () => {
    expect(manifest.configSchema.basePath.required).toBe(true);
    expect(manifest.configSchema.basePath.type).toBe('string');
  });

  test('is marked as implicit (always available)', () => {
    expect(manifest.implicit).toBe(true);
  });
});
