import { describe, test, expect, vi } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

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
    const svc = new ContentQueryService({ registry });

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
    const svc = new ContentQueryService({ registry });

    // Without withExif treated as a meta key, #canHandle would see queryKeys=['withExif'],
    // find no matching capability, and skip the adapter — so search would never be called.
    await svc.search({ source: 'immich', withExif: true });

    expect(adapter.search).toHaveBeenCalledTimes(1);
  });
});
