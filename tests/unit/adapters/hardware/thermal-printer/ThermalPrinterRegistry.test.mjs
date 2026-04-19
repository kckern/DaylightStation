import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs';

function makeAdapter(host, port = 9100) {
  return {
    getHost: () => host,
    getPort: () => port,
    isConfigured: () => true,
  };
}

describe('ThermalPrinterRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ThermalPrinterRegistry();
  });

  describe('register', () => {
    it('stores an adapter under the given name', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(registry.has('upstairs')).toBe(true);
    });

    it('marks an adapter as default when isDefault: true', () => {
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
      expect(registry.getDefault().getHost()).toBe('10.0.0.50');
    });

    it('throws when registering the same name twice', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(() =>
        registry.register('upstairs', makeAdapter('10.0.0.200'))
      ).toThrow(/already registered/i);
    });

    it('throws when registering a second default', () => {
      registry.register('a', makeAdapter('10.0.0.1'), { isDefault: true });
      expect(() =>
        registry.register('b', makeAdapter('10.0.0.2'), { isDefault: true })
      ).toThrow(/default/i);
    });
  });

  describe('get', () => {
    it('returns the adapter registered under name', () => {
      const adapter = makeAdapter('10.0.0.137');
      registry.register('upstairs', adapter);
      expect(registry.get('upstairs')).toBe(adapter);
    });

    it('throws a 404-shaped error when name is unknown', () => {
      expect(() => registry.get('nowhere')).toThrow(/unknown printer/i);
    });
  });

  describe('getDefault', () => {
    it('throws when no default has been configured', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(() => registry.getDefault()).toThrow(/no default/i);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
    });

    it('returns the named adapter when a name is given', () => {
      expect(registry.resolve('upstairs').getHost()).toBe('10.0.0.137');
    });

    it('falls back to the default when name is undefined', () => {
      expect(registry.resolve(undefined).getHost()).toBe('10.0.0.50');
    });

    it('falls back to the default when name is empty string', () => {
      expect(registry.resolve('').getHost()).toBe('10.0.0.50');
    });

    it('throws on unknown name even when a default exists', () => {
      expect(() => registry.resolve('nowhere')).toThrow(/unknown printer/i);
    });
  });

  describe('list', () => {
    it('returns one descriptor per registered printer', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        name: 'upstairs', host: '10.0.0.137', port: 9100, isDefault: false,
      });
      expect(list).toContainEqual({
        name: 'downstairs', host: '10.0.0.50', port: 9100, isDefault: true,
      });
    });

    it('returns empty array when nothing registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });
});
