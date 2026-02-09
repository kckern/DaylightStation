// tests/isolated/adapter/content/app-registry/AppRegistryDriver.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';

const MOCK_APPS = {
  webcam: { label: 'Webcam' },
  gratitude: { label: 'Gratitude & Hope' },
  'family-selector': { label: 'Family Selector', param: { name: 'winner', options: 'household' } },
  glympse: { label: 'Glympse', param: { name: 'id' } },
};

describe('AppRegistryDriver', () => {
  let driver;

  beforeEach(async () => {
    const mod = await import('#adapters/content/app-registry/AppRegistryDriver.mjs');
    const AppRegistryDriver = mod.AppRegistryDriver;
    driver = new AppRegistryDriver({ apps: MOCK_APPS });
  });

  describe('IContentSource interface', () => {
    it('has source = "app"', () => {
      expect(driver.source).toBe('app');
    });

    it('has contentFormat = "app"', () => {
      expect(driver.contentFormat).toBe('app');
    });

    it('has prefixes with "app"', () => {
      expect(driver.prefixes).toEqual([{ prefix: 'app' }]);
    });
  });

  describe('getItem', () => {
    it('resolves simple app ID', async () => {
      const item = await driver.getItem('webcam');
      expect(item).not.toBeNull();
      expect(item.id).toBe('app:webcam');
      expect(item.title).toBe('Webcam');
      expect(item.metadata.contentFormat).toBe('app');
      expect(item.metadata.appId).toBe('webcam');
      expect(item.metadata.appParam).toBeNull();
    });

    it('resolves app with slash param (family-selector/alan)', async () => {
      const item = await driver.getItem('family-selector/alan');
      expect(item).not.toBeNull();
      expect(item.id).toBe('app:family-selector/alan');
      expect(item.title).toBe('Family Selector');
      expect(item.metadata.appId).toBe('family-selector');
      expect(item.metadata.appParam).toBe('alan');
      expect(item.metadata.paramName).toBe('winner');
    });

    it('returns null for unknown app', async () => {
      const item = await driver.getItem('nonexistent');
      expect(item).toBeNull();
    });

    it('strips app: prefix if present', async () => {
      const item = await driver.getItem('app:webcam');
      expect(item).not.toBeNull();
      expect(item.metadata.appId).toBe('webcam');
    });
  });

  describe('getList', () => {
    it('returns all apps when called with empty ID', async () => {
      const items = await driver.getList('');
      expect(items.length).toBe(4);
      expect(items[0].title).toBeTruthy();
    });

    it('each item has correct structure', async () => {
      const items = await driver.getList('');
      const webcam = items.find(i => i.id === 'app:webcam');
      expect(webcam).toBeTruthy();
      expect(webcam.title).toBe('Webcam');
      expect(webcam.itemType).toBe('item');
    });
  });

  describe('resolvePlayables', () => {
    it('returns empty array (apps are not playable media)', async () => {
      const result = await driver.resolvePlayables('webcam');
      expect(result).toEqual([]);
    });
  });

  describe('resolveSiblings', () => {
    it('returns all apps as siblings', async () => {
      const result = await driver.resolveSiblings('app:webcam');
      expect(result.items.length).toBe(4);
      expect(result.parent).toBeNull();
    });
  });

  describe('getCapabilities', () => {
    it('returns ["openable"] for app items', async () => {
      const item = await driver.getItem('webcam');
      const caps = driver.getCapabilities(item);
      expect(caps).toContain('openable');
      expect(caps).not.toContain('playable');
    });
  });

  describe('search', () => {
    it('finds apps by label', async () => {
      const results = await driver.search('gratitude');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Gratitude & Hope');
    });

    it('finds apps by ID', async () => {
      const results = await driver.search('family');
      expect(results.length).toBe(1);
    });

    it('returns empty for no match', async () => {
      const results = await driver.search('zzzzz');
      expect(results).toEqual([]);
    });
  });
});
