// tests/isolated/applications/content/ContentQueryService.streamIdLookup.test.mjs
//
// Bug: typing a bare Plex rating key (697495) into the Media app ran only the
// text search over /query/search/stream. Direct-id recognition now comes from
// patterns the adapters declare (`directIdPatterns`), consulted by the shared
// gateway; search() and searchStream() run the lookup alongside the text
// search and the exact match must always lead.
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryService } from "../../../../__capabilities/content-catalog/server/application/ContentQueryService.mjs";
import { RegistryContentCatalogGateway } from "../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";
import { ContentSourceRegistry } from "../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs";
import { mergeSearchResults } from "../../../../frontend/src/hooks/useStreamingSearch.js";

const stub = (source, over = {}) => ({
  source,
  prefixes: [{ prefix: source }],
  getItem: vi.fn().mockResolvedValue(null),
  getList: vi.fn(), resolvePlayables: vi.fn(), resolveSiblings: vi.fn(),
  search: vi.fn().mockResolvedValue({ items: [] }),
  getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
  getQueryMappings: () => ({}),
  ...over,
});
const plexPattern = [{ pattern: /^\d{2,}$/, toId: (m) => `plex:${m[0]}` }];

const build = (adapters, logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }) => {
  const registry = new ContentSourceRegistry();
  adapters.forEach((a) => registry.register(a));
  const svc = new ContentQueryService({
    logger,
    contentCatalog: new RegistryContentCatalogGateway({ registry }),
  });
  return { svc, logger };
};
const plexItem = { id: 'plex:697495', title: 'The Item', source: 'plex' };
const buildPlex = ({ getItem, search } = {}) => {
  const plex = stub('plex', {
    directIdPatterns: plexPattern,
    getItem: getItem ?? vi.fn().mockResolvedValue(plexItem),
    ...(search && { search }),
  });
  return { plex, ...build([plex]) };
};
const collect = async (svc, text) => {
  const ev = [];
  for await (const e of svc.searchStream({ text })) ev.push(e);
  return ev;
};
const itemsOf = (events) => events.filter(e => e.event === 'results').flatMap(e => e.items);
// What the Media app shows: server events folded through the client reducer.
const clientOrder = (events, text) => events
  .filter(e => e.event === 'results')
  .reduce((acc, e) => mergeSearchResults(acc, e.items, text), [])
  .map(i => i.id);

describe('searchStream direct id interpretation', () => {
  it('streams plex:<n> for a bare number, text search still running', async () => {
    const { plex, svc } = buildPlex();
    const events = await collect(svc, '697495');
    const items = itemsOf(events);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'plex:697495', matchReason: 'id-lookup' });
    expect(items[0]._idMatch).toBeUndefined();
    expect(plex.getItem).toHaveBeenCalledWith('697495');
    expect(plex.search).toHaveBeenCalled();
    expect(events.at(-1).event).toBe('complete');
  });

  it('resolves explicit plex:<n> too', async () => {
    const { plex, svc } = buildPlex();
    await collect(svc, 'plex:697495');
    expect(plex.getItem).toHaveBeenCalledWith('697495');
  });

  it('does not look up an id for non-numeric text or a 1-digit number', async () => {
    const { plex, svc } = buildPlex();
    await collect(svc, 'beethoven');
    await collect(svc, '7');
    expect(plex.getItem).not.toHaveBeenCalled();
  });

  it('does nothing extra when no adapter declares patterns', async () => {
    const plex = stub('plex');
    const { svc } = build([plex]);
    await collect(svc, '697495');
    expect(plex.getItem).not.toHaveBeenCalled();
    expect(plex.search).toHaveBeenCalled();
  });

  it('a miss is silent: no warning, stream completes', async () => {
    const { svc } = buildPlex({ getItem: vi.fn().mockResolvedValue(null) });
    const events = await collect(svc, '1984');
    expect(itemsOf(events)).toHaveLength(0);
    expect(events.at(-1).warnings).toBeUndefined();
  });

  it('a 404 from the adapter is a silent miss; a real error is a warning', async () => {
    const notFound = Object.assign(new Error('Request failed'), { status: 404 });
    const a = buildPlex({ getItem: vi.fn().mockRejectedValue(notFound) });
    expect((await collect(a.svc, '1984')).at(-1).warnings).toBeUndefined();
    const b = buildPlex({ getItem: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const last = (await collect(b.svc, '1984')).at(-1);
    expect(last.event).toBe('complete');
    expect(last.warnings[0].error).toMatch(/ECONNREFUSED/);
  });

  it('logs pattern match and lookup hit/miss', async () => {
    const hit = buildPlex();
    await collect(hit.svc, '697495');
    const names = hit.logger.info.mock.calls.map(c => c[0]);
    expect(names).toContain('content-query.direct-id.matched');
    expect(names).toContain('content-query.direct-id.hit');
    const miss = buildPlex({ getItem: vi.fn().mockResolvedValue(null) });
    await collect(miss.svc, '697495');
    expect(miss.logger.info.mock.calls.map(c => c[0])).toContain('content-query.direct-id.miss');
  });

  describe('ordering: the exact id match leads', () => {
    const textHit = { id: 'plex:697495', title: 'Unrelated Title', source: 'plex' };
    const other = { id: 'plex:5', title: '697495 Minutes', source: 'plex' };

    it('text result for the same id arrives first (scores 0 on its own) -> present, first', async () => {
      const { svc } = buildPlex({ search: vi.fn().mockResolvedValue({ items: [other, textHit] }) });
      const events = await collect(svc, '697495');
      const items = itemsOf(events);
      expect(items.filter(i => i.id === 'plex:697495')).toHaveLength(1);
      const exact = items.find(i => i.id === 'plex:697495');
      expect(exact.score).toBeGreaterThan(items.find(i => i.id === 'plex:5').score);
      expect(clientOrder(events, '697495')[0]).toBe('plex:697495');
    });

    it('id result arrives last (slow lookup) -> still first after client merge', async () => {
      const slow = vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r(plexItem), 40)));
      const { svc } = buildPlex({ getItem: slow, search: vi.fn().mockResolvedValue({ items: [other] }) });
      const events = await collect(svc, '697495');
      const idxText = events.findIndex(e => e.event === 'results' && e.items.some(i => i.id === 'plex:5'));
      const idxId = events.findIndex(e => e.event === 'results' && e.items.some(i => i.id === 'plex:697495'));
      expect(idxId).toBeGreaterThan(idxText); // arrives last
      expect(clientOrder(events, '697495')).toEqual(['plex:697495', 'plex:5']);
    });

    it('text copy of the id arrives first, lookup copy last -> one copy, ranked first', async () => {
      const slow = vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r(plexItem), 40)));
      const { svc } = buildPlex({ getItem: slow, search: vi.fn().mockResolvedValue({ items: [textHit, other] }) });
      const events = await collect(svc, '697495');
      expect(itemsOf(events).filter(i => i.id === 'plex:697495')).toHaveLength(1);
      expect(clientOrder(events, '697495')[0]).toBe('plex:697495');
    });
  });
});

describe('several adapters match one query', () => {
  const two = () => {
    const a = stub('alpha', {
      directIdPatterns: [{ pattern: /^\d{4,}$/, toId: (m) => `alpha:${m[0]}`, priority: 1 }],
      getItem: vi.fn().mockResolvedValue({ id: 'alpha:12345', title: 'A', source: 'alpha' }),
    });
    const p = stub('plex', {
      directIdPatterns: plexPattern,
      getItem: vi.fn().mockResolvedValue({ id: 'plex:12345', title: 'P', source: 'plex' }),
    });
    return { a, p };
  };

  it('looks each up (in parallel), higher priority first, then registration order', async () => {
    const { a, p } = two();
    const { svc } = build([p, a]); // plex registered first, alpha has priority
    const events = await collect(svc, '12345');
    expect(a.getItem).toHaveBeenCalledWith('12345');
    expect(p.getItem).toHaveBeenCalledWith('12345');
    expect(itemsOf(events).map(i => i.id)).toEqual(['alpha:12345', 'plex:12345']);
  });

  it('search() returns both id matches leading', async () => {
    const { a, p } = two();
    const { svc } = build([p, a]);
    const result = await svc.search({ text: '12345' });
    expect(result.items.slice(0, 2).map(i => i.id)).toEqual(['alpha:12345', 'plex:12345']);
  });
});

describe('search() direct id', () => {
  it('leads with the bare-number plex item', async () => {
    const { svc } = buildPlex({
      search: vi.fn().mockResolvedValue({ items: [{ id: 'plex:5', title: '697495 Minutes', source: 'plex' }] }),
    });
    const result = await svc.search({ text: '697495' });
    expect(result.items[0]).toMatchObject({ id: 'plex:697495', matchReason: 'id-lookup' });
  });
});
