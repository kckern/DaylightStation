// tests/isolated/application/feed/ContentPluginRegistry.test.mjs
import { jest } from '@jest/globals';
import { IContentPlugin } from '#apps/feed/plugins/IContentPlugin.mjs';

describe('IContentPlugin', () => {
  test('throws if contentType not implemented', () => {
    const plugin = new IContentPlugin();
    expect(() => plugin.contentType).toThrow('must be implemented');
  });

  test('detect() returns false by default', () => {
    const plugin = new IContentPlugin();
    expect(plugin.detect({ link: 'https://example.com' })).toBe(false);
  });

  test('enrich() returns empty object by default', () => {
    const plugin = new IContentPlugin();
    expect(plugin.enrich({ link: 'https://example.com' })).toEqual({});
  });
});
