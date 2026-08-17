// tests/isolated/adapter/persistence/YamlListDatastore.contentPath.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { YamlListDatastore } from '#adapters/persistence/yaml/YamlListDatastore.mjs';

/**
 * Proves YamlListDatastore (task 11) resolves list storage under
 * {dataDir}/content/lists/<type>/, using userDataService.getDataDir() —
 * NOT userDataService.getHouseholdDir() + config/lists, which would nest
 * it under the household tree instead of the top-level content/ tree.
 */
describe('YamlListDatastore content/lists path resolution', () => {
  it('_getListsBaseDir uses getDataDir(), not getHouseholdDir()', () => {
    const getDataDir = vi.fn(() => '/fake/data');
    const getHouseholdDir = vi.fn(() => '/fake/data/household');
    const store = new YamlListDatastore({
      userDataService: { getDataDir, getHouseholdDir },
      configService: { getDefaultHouseholdId: () => 'default' },
    });

    const base = store._getListsBaseDir();
    expect(base).toBe('/fake/data/content/lists');
    expect(getDataDir).toHaveBeenCalled();
    expect(getHouseholdDir).not.toHaveBeenCalled();
  });

  it('_getListPath resolves a type/name file under content/lists/', () => {
    const store = new YamlListDatastore({
      userDataService: { getDataDir: () => '/fake/data' },
      configService: { getDefaultHouseholdId: () => 'default' },
    });

    expect(store._getListPath('menus', 'fhe.yml')).toBe('/fake/data/content/lists/menus/fhe.yml');
  });

  it('getOverview reports content/lists/<type> as the path field', () => {
    const store = new YamlListDatastore({
      userDataService: { getDataDir: () => '/fake/data' },
      configService: { getDefaultHouseholdId: () => 'default' },
    });

    const overview = store.getOverview();
    expect(overview.find((o) => o.type === 'menus').path).toBe('content/lists/menus');
  });
});
