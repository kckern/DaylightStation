import { describe, test, expect, vi } from 'vitest';
import { ContentQueryService } from "../../../../__capabilities/content-catalog/server/application/ContentQueryService.mjs";
import { RegistryContentCatalogGateway } from "../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";

const catalogFor = (registry) => new RegistryContentCatalogGateway({ registry });

function makeImmichLikeAdapter() {
  return {
    source: 'immich',
    getSearchCapabilities: () => ({ canonical: ['text', 'time', 'mediaType'], specific: [] }),
    getQueryMappings: () => ({ time: { from: 'takenAfter', to: 'takenBefore' } }),
    search: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
}

describe('ContentQueryService enrichment-flag handling', () => {
  test('a time query carrying withExif/withPeople still reaches the adapter', async () => {
    const adapter = makeImmichLikeAdapter();
    const registry = {
      get: () => adapter,
      resolveSource: () => [adapter],
    };
    const svc = new ContentQueryService({ contentCatalog: catalogFor(registry) });

    await svc.search({
      source: 'immich',
      time: { from: '2025-12-25', to: '2025-12-26' },
      withExif: true,
      withPeople: true,
    });

    expect(adapter.search).toHaveBeenCalledTimes(1);
    const passed = adapter.search.mock.calls[0][0];
    expect(passed.takenAfter).toBe('2025-12-25');
    expect(passed.takenBefore).toBe('2025-12-26');
    expect(passed.withExif).toBe(true);
    expect(passed.withPeople).toBe(true);
  });

  test('a query whose only non-meta key is an enrichment flag still reaches the adapter', async () => {
    const adapter = makeImmichLikeAdapter();
    const registry = { get: () => adapter, resolveSource: () => [adapter] };
    const svc = new ContentQueryService({ contentCatalog: catalogFor(registry) });

    // Without withExif treated as a meta key, #canHandle would see queryKeys=['withExif'],
    // find no matching capability, and skip the adapter — so search would never be called.
    await svc.search({ source: 'immich', withExif: true });

    expect(adapter.search).toHaveBeenCalledTimes(1);
  });
});

// 2026-11-27: YouTube search (Video › YouTube scope) searches the outside
// world, so it must answer only a search scoped to it.
describe('ContentQueryService explicit-only sources', () => {
  function setupTwo() {
    const local = {
      source: 'plex',
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      search: vi.fn().mockResolvedValue({ items: [{ id: 'plex:1', source: 'plex', title: 'Bluey' }], total: 1 }),
    };
    const outside = {
      source: 'youtube',
      getSearchCapabilities: () => ({ canonical: ['text', 'mediaType'], specific: [], explicitOnly: true }),
      search: vi.fn().mockResolvedValue({ items: [{ id: 'youtube:abc', source: 'youtube', title: 'Bluey' }], total: 1 }),
    };
    const bySource = { plex: local, youtube: outside };
    const registry = {
      get: (name) => bySource[name],
      resolveSource: (sel) => (sel ? [bySource[sel]].filter(Boolean) : [local, outside]),
    };
    return { local, outside, svc: new ContentQueryService({ contentCatalog: catalogFor(registry) }) };
  }

  test('an unscoped search never reaches an explicit-only source', async () => {
    const { local, outside, svc } = setupTwo();
    await svc.search({ text: 'bluey' });
    expect(local.search).toHaveBeenCalledTimes(1);
    expect(outside.search).not.toHaveBeenCalled();
  });

  test('a search scoped to it does', async () => {
    const { outside, svc } = setupTwo();
    const result = await svc.search({ source: 'youtube', text: 'bluey', mediaType: 'video' });
    expect(outside.search).toHaveBeenCalledTimes(1);
    expect(result.items.map((i) => i.id)).toEqual(['youtube:abc']);
  });

  test('the streaming search skips it too when unscoped', async () => {
    const { outside, svc } = setupTwo();
    for await (const _event of svc.searchStream({ text: 'bluey' })) { /* drain */ }
    expect(outside.search).not.toHaveBeenCalled();
  });
});
