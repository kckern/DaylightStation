// tests/isolated/adapter/content/list/ListAdapter.contentPath.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Proves the list path resolution (task 11 of the data/media reorg) lives
 * under content/lists/, NOT household[-{id}]/config/lists/ — menus, programs
 * and watchlists are authored content, not per-household settings, so the
 * lookup is a single top-level path with no household-scoped fallback loop.
 */
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => false),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 0 })),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

describe('ListAdapter content/lists path resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FileIO.fileExists.mockReturnValue(false);
    FileIO.dirExists.mockReturnValue(false);
  });

  it('_getListPath resolves under content/lists/, never household/config/lists/', () => {
    const adapter = new ListAdapter({ dataPath: '/fake/data' });
    const resolved = adapter._getListPath('menus', 'fhe');
    expect(resolved).toBe('/fake/data/content/lists/menus/fhe.yml');
    expect(resolved).not.toMatch(/household.*config.*lists/);
  });

  it('_getListPath ignores householdId — content/ is not household-scoped', () => {
    const adapter = new ListAdapter({ dataPath: '/fake/data', householdId: 'other-house' });
    const resolved = adapter._getListPath('watchlists', 'kids-movies');
    expect(resolved).toBe('/fake/data/content/lists/watchlists/kids-movies.yml');
  });

  it('_getListDir resolves under content/lists/<type>/', () => {
    const adapter = new ListAdapter({ dataPath: '/fake/data' });
    expect(adapter._getListDir('programs')).toBe('/fake/data/content/lists/programs');
  });
});
