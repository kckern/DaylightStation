import { describe, it, expect, vi } from 'vitest';
import { ContentSourceRegistry } from "../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs";
import { RegistryContentCatalogGateway } from "../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";
import { PlexAdapter } from "../../../../__capabilities/content-catalog/server/adapters/providers/plex/PlexAdapter.mjs";
import { ImmichAdapter } from "../../../../__capabilities/content-catalog/server/adapters/providers/gallery/immich/ImmichAdapter.mjs";

const stub = (source, directIdPatterns) => ({
  source, prefixes: [{ prefix: source }],
  getItem: vi.fn(), getList: vi.fn(), resolvePlayables: vi.fn(), resolveSiblings: vi.fn(),
  ...(directIdPatterns && { directIdPatterns }),
});
const gw = (...adapters) => {
  const registry = new ContentSourceRegistry();
  adapters.forEach(a => registry.register(a));
  return new RegistryContentCatalogGateway({ registry, prefixAliases: { hymn: 'singalong:hymn' } });
};

describe('ContentSourceRegistry.getDirectIdPatterns', () => {
  it('collects declarations; adapters without any contribute nothing', () => {
    const r = new ContentSourceRegistry();
    r.register(stub('plex', [{ pattern: /^\d{2,}$/, toId: m => `plex:${m[0]}` }]));
    r.register(stub('files'));
    expect(r.getDirectIdPatterns().map(d => d.source)).toEqual(['plex']);
  });

  it('orders by priority then registration, and ignores malformed declarations', () => {
    const r = new ContentSourceRegistry();
    r.register(stub('a', [{ pattern: /x/, toId: m => m[0] }]));
    r.register(stub('b', [{ pattern: /x/, toId: m => m[0], priority: 5 }, { pattern: 'nope' }]));
    expect(r.getDirectIdPatterns().map(d => d.source)).toEqual(['b', 'a']);
  });
});

describe('gateway parseDirectReference(s)', () => {
  it('bare digits resolve through the declaring adapter, not a hardcoded rule', () => {
    const withPlex = gw(stub('plex', [{ pattern: /^\d{2,}$/, toId: m => `plex:${m[0]}` }]));
    expect(withPlex.parseDirectReference('697495')).toEqual({ source: 'plex', id: '697495' });
    expect(withPlex.parseDirectReference('7')).toBeNull();
    expect(gw(stub('plex')).parseDirectReference('697495')).toBeNull();
  });

  it('explicit source:id and legacy prefixes are unaffected by patterns', () => {
    const g = gw(stub('plex', [{ pattern: /^\d{2,}$/, toId: m => `plex:${m[0]}` }]));
    expect(g.parseDirectReference('plex:456724')).toEqual({ source: 'plex', id: '456724' });
    expect(g.parseDirectReference('hymn:113')).toEqual({ source: 'singalong', id: 'hymn/113' });
    expect(g.parseDirectReferences('immich:abc')).toEqual([{ source: 'immich', id: 'abc' }]);
  });

  it('returns every matching adapter in order, deduped and bounded', () => {
    const g = gw(
      stub('a', [{ pattern: /^\d+$/, toId: m => `a:${m[0]}` }]),
      stub('b', [{ pattern: /^\d+$/, toId: m => `b:${m[0]}` }, { pattern: /^\d+$/, toId: m => `b:${m[0]}` }]),
    );
    expect(g.parseDirectReferences('123')).toEqual([{ source: 'a', id: '123' }, { source: 'b', id: '123' }]);
    const many = gw(...['a', 'b', 'c', 'd', 'e', 'f'].map(s => stub(s, [{ pattern: /^\d+$/, toId: m => `${s}:${m[0]}` }])));
    expect(many.parseDirectReferences('123')).toHaveLength(4);
  });

  it('the real Plex and Immich adapters declare their shapes', () => {
    const plex = Object.create(PlexAdapter.prototype);
    const immich = Object.create(ImmichAdapter.prototype);
    const [pp] = plex.directIdPatterns;
    expect(pp.pattern.test('697495')).toBe(true);
    expect(pp.pattern.test('9')).toBe(false);
    expect(pp.pattern.test('12ab')).toBe(false);
    expect(pp.toId('697495'.match(pp.pattern))).toBe('plex:697495');
    const [ip] = immich.directIdPatterns;
    expect(ip.pattern.test('ff940f1a-f5ea-4580-a517-dfc68413e215')).toBe(true);
    expect(ip.pattern.test('697495')).toBe(false);
  });
});
