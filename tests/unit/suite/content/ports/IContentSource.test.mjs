// tests/unit/content/ports/IContentSource.test.mjs
import { validateAdapter, ContentSourceBase } from '#backend/src/1_domains/content/ports/IContentSource.mjs';

describe('IContentSource port', () => {
  test('validateAdapter rejects invalid adapter', () => {
    expect(() => validateAdapter({})).toThrow('must have source property');
    expect(() => validateAdapter({ source: 'test' })).toThrow('must have prefixes array');
  });

  test('validateAdapter accepts valid adapter structure', () => {
    const validAdapter = {
      source: 'test',
      prefixes: [{ prefix: 'test' }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    expect(() => validateAdapter(validAdapter)).not.toThrow();
  });

  test('validateAdapter rejects adapter missing getItem', () => {
    const adapter = {
      source: 'test',
      prefixes: [{ prefix: 'test' }],
      getList: async () => [],
      resolvePlayables: async () => []
    };
    expect(() => validateAdapter(adapter)).toThrow('must implement getItem');
  });

  test('validateAdapter rejects adapter missing getList', () => {
    const adapter = {
      source: 'test',
      prefixes: [{ prefix: 'test' }],
      getItem: async () => null,
      resolvePlayables: async () => []
    };
    expect(() => validateAdapter(adapter)).toThrow('must implement getList');
  });

  test('validateAdapter rejects adapter missing resolvePlayables', () => {
    const adapter = {
      source: 'test',
      prefixes: [{ prefix: 'test' }],
      getItem: async () => null,
      getList: async () => []
    };
    expect(() => validateAdapter(adapter)).toThrow('must implement resolvePlayables');
  });
});

describe('ContentSourceBase', () => {
  test('cannot instantiate directly', () => {
    expect(() => new ContentSourceBase()).toThrow('ContentSourceBase is abstract');
  });

  test('can be extended by concrete implementations', () => {
    class TestAdapter extends ContentSourceBase {
      get source() { return 'test'; }
      get prefixes() { return [{ prefix: 'test' }]; }
      async getItem(id) { return null; }
      async getList(id) { return []; }
      async resolvePlayables(id) { return []; }
    }

    const adapter = new TestAdapter();
    expect(adapter.source).toBe('test');
    expect(adapter.prefixes).toEqual([{ prefix: 'test' }]);
  });

  test('abstract methods throw when not overridden', async () => {
    class PartialAdapter extends ContentSourceBase {
      get source() { return 'partial'; }
      get prefixes() { return []; }
    }

    const adapter = new PartialAdapter();
    await expect(adapter.getItem('test')).rejects.toThrow('getItem must be implemented');
    await expect(adapter.getList('test')).rejects.toThrow('getList must be implemented');
    await expect(adapter.resolvePlayables('test')).rejects.toThrow('resolvePlayables must be implemented');
  });
});
