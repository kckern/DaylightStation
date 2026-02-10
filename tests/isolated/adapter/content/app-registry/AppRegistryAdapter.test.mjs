// tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';

const MOCK_APPS = {
  webcam: { label: 'Webcam' },
  gratitude: { label: 'Gratitude & Hope' },
  'family-selector': { label: 'Family Selector', param: { name: 'winner', options: 'household' } },
  glympse: { label: 'Glympse', param: { name: 'id' } },
};

describe('AppRegistryAdapter', () => {
  let adapter;

  beforeEach(async () => {
    const mod = await import('#adapters/content/app-registry/AppRegistryAdapter.mjs');
    const AppRegistryAdapter = mod.AppRegistryAdapter;
    adapter = new AppRegistryAdapter({ apps: MOCK_APPS });
  });

  describe('IContentSource interface', () => {
    it('has source = "app"', () => {
      expect(adapter.source).toBe('app');
    });

    it('has contentFormat = "app"', () => {
      expect(adapter.contentFormat).toBe('app');
    });

    it('has prefixes with "app"', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'app' }]);
    });
  });

  describe('getItem', () => {
    it('resolves simple app ID', async () => {
      const item = await adapter.getItem('webcam');
      expect(item).not.toBeNull();
      expect(item.id).toBe('app:webcam');
      expect(item.title).toBe('Webcam');
      expect(item.metadata.contentFormat).toBe('app');
      expect(item.metadata.appId).toBe('webcam');
      expect(item.metadata.appParam).toBeNull();
    });

    it('resolves app with slash param (family-selector/alan)', async () => {
      const item = await adapter.getItem('family-selector/alan');
      expect(item).not.toBeNull();
      expect(item.id).toBe('app:family-selector/alan');
      expect(item.title).toBe('Family Selector');
      expect(item.metadata.appId).toBe('family-selector');
      expect(item.metadata.appParam).toBe('alan');
      expect(item.metadata.paramName).toBe('winner');
    });

    it('returns null for unknown app', async () => {
      const item = await adapter.getItem('nonexistent');
      expect(item).toBeNull();
    });

    it('strips app: prefix if present', async () => {
      const item = await adapter.getItem('app:webcam');
      expect(item).not.toBeNull();
      expect(item.metadata.appId).toBe('webcam');
    });
  });

  describe('getList', () => {
    it('returns all apps when called with empty ID', async () => {
      const items = await adapter.getList('');
      expect(items.length).toBe(4);
      expect(items[0].title).toBeTruthy();
    });

    it('each item has correct structure', async () => {
      const items = await adapter.getList('');
      const webcam = items.find(i => i.id === 'app:webcam');
      expect(webcam).toBeTruthy();
      expect(webcam.title).toBe('Webcam');
      expect(webcam.itemType).toBe('item');
    });
  });

  describe('resolvePlayables', () => {
    it('returns empty array (apps are not playable media)', async () => {
      const result = await adapter.resolvePlayables('webcam');
      expect(result).toEqual([]);
    });
  });

  describe('resolveSiblings', () => {
    it('returns all apps as siblings', async () => {
      const result = await adapter.resolveSiblings('app:webcam');
      expect(result.items.length).toBe(4);
      expect(result.parent).toBeNull();
    });
  });

  describe('getCapabilities', () => {
    it('returns ["openable"] for app items', async () => {
      const item = await adapter.getItem('webcam');
      const caps = adapter.getCapabilities(item);
      expect(caps).toContain('openable');
      expect(caps).not.toContain('playable');
    });
  });

  describe('search', () => {
    it('finds apps by label', async () => {
      const results = await adapter.search('gratitude');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Gratitude & Hope');
    });

    it('finds apps by ID', async () => {
      const results = await adapter.search('family');
      expect(results.length).toBe(1);
    });

    it('returns empty for no match', async () => {
      const results = await adapter.search('zzzzz');
      expect(results).toEqual([]);
    });
  });
});
