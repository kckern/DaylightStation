// tests/isolated/adapter/persistence/YamlListDatastore.contentPath.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { YamlListDatastore } from '#adapters/persistence/yaml/YamlListDatastore.mjs';
import { ListConfigCodec } from '#adapters/content/list/ListConfigCodec.mjs';

/**
 * Proves YamlListDatastore (task 11) resolves list storage under
 * {dataDir}/content/lists/<type>/, rather than nesting it under a household
 * configuration tree.
 */
describe('YamlListDatastore content/lists path resolution', () => {
  it('_getListsBaseDir uses the injected data root', () => {
    const store = new YamlListDatastore({
      dataDir: '/fake/data', listConfigCodec: ListConfigCodec,
    });

    const base = store._getListsBaseDir();
    expect(base).toBe('/fake/data/content/lists');
  });

  it('_getListPath resolves a type/name file under content/lists/', () => {
    const store = new YamlListDatastore({
      dataDir: '/fake/data', listConfigCodec: ListConfigCodec,
    });

    expect(store._getListPath('menus', 'fhe.yml')).toBe('/fake/data/content/lists/menus/fhe.yml');
  });

  it('getOverview returns semantic summaries without exposing storage paths', () => {
    const store = new YamlListDatastore({
      dataDir: '/fake/data', listConfigCodec: ListConfigCodec,
    });

    const overview = store.getOverview();
    expect(overview.find((o) => o.type === 'menus')).toEqual({ type: 'menus', count: 0 });
  });
});
