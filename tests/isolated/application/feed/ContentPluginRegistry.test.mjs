// tests/isolated/application/feed/ContentPluginRegistry.test.mjs
import { jest } from '@jest/globals';
import { IContentPlugin } from '#apps/feed/plugins/IContentPlugin.mjs';
import { ContentPluginRegistry } from '#apps/feed/services/ContentPluginRegistry.mjs';

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

describe('ContentPluginRegistry', () => {
  const makePlugin = (type, detectFn, enrichFn) => ({
    contentType: type,
    detect: detectFn,
    enrich: enrichFn,
  });

  test('enrich() returns items unchanged when no plugins match', () => {
    const registry = new ContentPluginRegistry([]);
    const items = [{ id: '1', link: 'https://example.com', meta: {} }];
    const result = registry.enrich(items);
    expect(result).toEqual(items);
    expect(result[0].contentType).toBeUndefined();
  });

  test('enrich() applies matching plugin metadata', () => {
    const plugin = makePlugin(
      'youtube',
      (item) => item.link?.includes('youtube.com'),
      (item) => ({ contentType: 'youtube', meta: { videoId: 'abc', playable: true } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', link: 'https://youtube.com/watch?v=abc', meta: { feedTitle: 'Tech' } }];
    const result = registry.enrich(items);
    expect(result[0].contentType).toBe('youtube');
    expect(result[0].meta.videoId).toBe('abc');
    expect(result[0].meta.playable).toBe(true);
    // Original meta preserved
    expect(result[0].meta.feedTitle).toBe('Tech');
  });

  test('enrich() skips items that already have a contentType', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', meta: { videoId: 'new' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', contentType: 'youtube', meta: { videoId: 'existing' } }];
    const result = registry.enrich(items);
    expect(result[0].meta.videoId).toBe('existing');
  });

  test('enrich() skips items whose source matches the contentType', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', meta: { videoId: 'overwritten' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', source: 'youtube', meta: { videoId: 'original' } }];
    const result = registry.enrich(items);
    expect(result[0].meta.videoId).toBe('original');
  });

  test('first matching plugin wins', () => {
    const pluginA = makePlugin('youtube', () => true, () => ({ contentType: 'youtube', meta: { from: 'A' } }));
    const pluginB = makePlugin('youtube', () => true, () => ({ contentType: 'youtube', meta: { from: 'B' } }));
    const registry = new ContentPluginRegistry([pluginA, pluginB]);
    const items = [{ id: '1', link: 'https://youtube.com', meta: {} }];
    const result = registry.enrich(items);
    expect(result[0].meta.from).toBe('A');
  });

  test('enrich() merges meta shallowly (plugin meta keys override, others preserved)', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', image: 'thumb.jpg', meta: { videoId: 'v1' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', link: 'https://youtube.com', image: null, meta: { feedTitle: 'Feed' } }];
    const result = registry.enrich(items);
    expect(result[0].image).toBe('thumb.jpg');
    expect(result[0].meta.videoId).toBe('v1');
    expect(result[0].meta.feedTitle).toBe('Feed');
  });
});
