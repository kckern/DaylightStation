// tests/unit/adapters/content/FilesystemAdapter.test.mjs
import { FilesystemAdapter } from '../../../../backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('FilesystemAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });
  });

  test('has correct source and prefixes', () => {
    expect(adapter.source).toBe('filesystem');
    expect(adapter.prefixes).toContainEqual({ prefix: 'media' });
    expect(adapter.prefixes).toContainEqual({ prefix: 'file' });
  });

  test('getItem returns item for existing file', async () => {
    const item = await adapter.getItem('audio/test.mp3');

    expect(item).not.toBeNull();
    expect(item.id).toBe('filesystem:audio/test.mp3');
    expect(item.source).toBe('filesystem');
    expect(item.mediaType).toBe('audio');
  });

  test('getItem returns null for missing file', async () => {
    const item = await adapter.getItem('nonexistent.mp3');
    expect(item).toBeNull();
  });

  test('getList returns directory contents', async () => {
    const list = await adapter.getList('audio');

    expect(list.length).toBeGreaterThan(0);
    expect(list[0].itemType).toBe('leaf');
  });

  test('resolvePlayables flattens directory', async () => {
    const playables = await adapter.resolvePlayables('audio');

    expect(playables.length).toBeGreaterThan(0);
    expect(playables[0].mediaUrl).toBeDefined();
  });

  test('prevents path traversal attacks', async () => {
    // Attempt to escape the media directory with ..
    const item1 = await adapter.getItem('../../../etc/passwd');
    expect(item1).toBeNull();

    const item2 = await adapter.getItem('audio/../../../../../../etc/passwd');
    expect(item2).toBeNull();

    // Test with encoded path traversal
    const item3 = await adapter.getItem('..%2F..%2Fetc/passwd');
    expect(item3).toBeNull();

    // Test getList with path traversal
    const list1 = await adapter.getList('../../../etc');
    expect(list1).toEqual([]);

    const list2 = await adapter.getList('audio/../../../etc');
    expect(list2).toEqual([]);
  });

  test('throws error when mediaBasePath is missing', () => {
    expect(() => new FilesystemAdapter({})).toThrow('FilesystemAdapter requires mediaBasePath');
    expect(() => new FilesystemAdapter({ mediaBasePath: '' })).toThrow('FilesystemAdapter requires mediaBasePath');
  });
});
