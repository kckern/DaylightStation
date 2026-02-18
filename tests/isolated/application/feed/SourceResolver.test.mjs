import { SourceResolver } from '#apps/feed/services/SourceResolver.mjs';

describe('SourceResolver', () => {
  const mockAdapters = [
    { sourceType: 'freshrss',    provides: ['feeds'] },
    { sourceType: 'headlines',   provides: ['news'] },
    { sourceType: 'googlenews',  provides: ['news'] },
    { sourceType: 'reddit',      provides: ['social'] },
    { sourceType: 'immich',      provides: ['photos'] },
    { sourceType: 'plex',        provides: ['video'] },
    { sourceType: 'youtube',     provides: ['video'] },
    { sourceType: 'komga',       provides: ['comics'] },
  ];

  let resolver;

  beforeEach(() => {
    resolver = new SourceResolver(mockAdapters);
  });

  test('resolves vendor alias to single adapter', () => {
    const result = resolver.resolve('freshrss');
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('freshrss');
  });

  test('resolves content type to all matching adapters', () => {
    const result = resolver.resolve('news');
    expect(result).toHaveLength(2);
    expect(result.map(a => a.sourceType).sort()).toEqual(['googlenews', 'headlines']);
  });

  test('resolves video content type to plex + youtube', () => {
    const result = resolver.resolve('video');
    expect(result).toHaveLength(2);
    expect(result.map(a => a.sourceType).sort()).toEqual(['plex', 'youtube']);
  });

  test('vendor alias takes precedence over content type', () => {
    const result = resolver.resolve('reddit');
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('reddit');
  });

  test('returns empty array for unknown key', () => {
    const result = resolver.resolve('nonexistent');
    expect(result).toHaveLength(0);
  });

  test('getInstanceMap returns all vendor aliases', () => {
    const map = resolver.getInstanceMap();
    expect(map.has('freshrss')).toBe(true);
    expect(map.has('plex')).toBe(true);
    expect(map.size).toBe(8);
  });

  test('getContentMap returns content type to adapter mapping', () => {
    const map = resolver.getContentMap();
    expect(map.get('news')).toHaveLength(2);
    expect(map.get('feeds')).toHaveLength(1);
    expect(map.get('video')).toHaveLength(2);
  });
});
