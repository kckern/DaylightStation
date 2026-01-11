// tests/unit/adapters/content/FilesystemAdapter.test.mjs
import { FilesystemAdapter } from '../../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
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
});
