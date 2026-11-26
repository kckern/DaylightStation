// tests/isolated/adapter/content/query/QueryAdapter.immich-people.test.mjs
// People-mode Immich entries (`params.personIds`) and the `instance` field that
// routes an entry to a second Immich server.
import { describe, it, expect, vi } from 'vitest';
import { QueryAdapter } from "../../../../../__capabilities/content-catalog/server/adapters/providers/query/QueryAdapter.mjs";

const asset = (prefix, id, localDateTime, mediaType = 'image') => ({
  id: `${prefix}:${id}`,
  mediaType,
  metadata: { localDateTime },
});

function makeAdapter({ entry, galleries }) {
  const registry = { get: (name) => galleries[name] || null };
  return new QueryAdapter({
    registry,
    savedQueryService: { getQuery: (name) => (name === 'q' ? { title: 'Q', items: [entry] } : null) },
  });
}

describe('QueryAdapter Immich people mode', () => {
  it('unions one search per person on the named instance, dedupes, and sorts oldest first', async () => {
    const family = {
      search: vi.fn(async ({ personIds }) => ({
        items: personIds[0] === 'p1'
          ? [asset('familyphotos', 'b', '1990-05-01T10:00:00'), asset('familyphotos', 'shared', '2001-01-01T00:00:00')]
          : [asset('familyphotos', 'shared', '2001-01-01T00:00:00'), asset('familyphotos', 'a', '1975-07-04T09:00:00')],
      })),
    };
    const main = { search: vi.fn() };
    const adapter = makeAdapter({
      galleries: { familyphotos: family, immich: main },
      entry: {
        type: 'immich',
        instance: 'familyphotos',
        sort: 'date_asc',
        params: { personIds: ['p1', 'p2'] },
        exclude: ['b'],
        slideshow: { duration: 5, focusPerson: 'Liza Dailey' },
      },
    });

    const items = await adapter.resolvePlayables('query:q');

    expect(main.search).not.toHaveBeenCalled();
    expect(family.search.mock.calls.map(([q]) => q.personIds)).toEqual([['p1'], ['p2']]);
    expect(items.map(i => i.id)).toEqual(['familyphotos:a', 'familyphotos:shared']);
    expect(items.every(i => i.slideshow?.focusPerson === 'Liza Dailey')).toBe(true);
  });

  it('match: all sends the whole list in one search (Immich ANDs personIds)', async () => {
    const family = { search: vi.fn(async () => ({ items: [asset('familyphotos', 'x', '2000-01-01T00:00:00')] })) };
    const adapter = makeAdapter({
      galleries: { familyphotos: family },
      entry: { type: 'immich', instance: 'familyphotos', params: { personIds: ['p1', 'p2'], match: 'all' } },
    });

    await adapter.resolvePlayables('query:q');

    expect(family.search).toHaveBeenCalledTimes(1);
    expect(family.search.mock.calls[0][0].personIds).toEqual(['p1', 'p2']);
  });

  it('yearFrom / yearTo bound the capture year', async () => {
    const family = {
      search: vi.fn(async () => ({
        items: [
          asset('familyphotos', 'old', '1969-01-01T00:00:00'),
          asset('familyphotos', 'mid', '1985-01-01T00:00:00'),
          asset('familyphotos', 'new', '2020-01-01T00:00:00'),
        ],
      })),
    };
    const adapter = makeAdapter({
      galleries: { familyphotos: family },
      entry: { type: 'immich', instance: 'familyphotos', params: { personIds: ['p1'], yearFrom: 1970, yearTo: 2000 } },
    });

    const items = await adapter.resolvePlayables('query:q');
    expect(items.map(i => i.id)).toEqual(['familyphotos:mid']);
  });

  it('an unregistered instance resolves to nothing rather than the main library', async () => {
    const main = { search: vi.fn(async () => ({ items: [asset('immich', 'z', '2000-01-01T00:00:00')] })) };
    const adapter = makeAdapter({
      galleries: { immich: main },
      entry: { type: 'immich', instance: 'familyphotos', params: { personIds: ['p1'] } },
    });

    expect(await adapter.resolvePlayables('query:q')).toEqual([]);
    expect(main.search).not.toHaveBeenCalled();
  });
});
