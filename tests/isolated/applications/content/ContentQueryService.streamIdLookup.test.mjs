// tests/isolated/applications/content/ContentQueryService.streamIdLookup.test.mjs
//
// Bug: typing a bare Plex rating key (697495) into the Media app ran only the
// text search over /query/search/stream and found nothing. The non-streaming
// search() already resolves "plex:123" / bare digits via parseDirectReference;
// searchStream never did. The stream must run the same id lookup alongside the
// text search. (Minimum length: the route already rejects text < 2 chars, so
// the shortest id looked up is 2 digits; the shared parser has no other floor.)
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryService } from "../../../../__capabilities/content-catalog/server/application/ContentQueryService.mjs";
import { RegistryContentCatalogGateway } from "../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";

const build = ({ getItem, plexSearch } = {}) => {
  const plex = {
    source: 'plex',
    search: plexSearch ?? vi.fn().mockResolvedValue({ items: [] }),
    getItem: getItem ?? vi.fn().mockResolvedValue({ id: 'plex:697495', title: 'The Item', source: 'plex' }),
    getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
    getQueryMappings: () => ({}),
  };
  const registry = { resolveSource: () => [plex], get: (s) => (s === 'plex' ? plex : undefined) };
  const svc = new ContentQueryService({
    deadline: { run: (work) => work },
    contentCatalog: new RegistryContentCatalogGateway({ registry }),
  });
  return { plex, svc };
};
const collect = async (svc, text) => {
  const ev = [];
  for await (const e of svc.searchStream({ text })) ev.push(e);
  return ev;
};
const itemsOf = (events) => events.filter(e => e.event === 'results').flatMap(e => e.items);

describe('ContentQueryService.searchStream direct id interpretation', () => {
  it('streams plex:<n> as an id-lookup result for a bare number, with text search still running', async () => {
    const { plex, svc } = build();
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
    const { plex, svc } = build();
    await collect(svc, 'plex:697495');
    expect(plex.getItem).toHaveBeenCalledWith('697495');
  });

  it('does not duplicate when the text search returns the same item', async () => {
    const { svc } = build({ plexSearch: vi.fn().mockResolvedValue({ items: [{ id: 'plex:697495', title: '697495 Minutes' }] }) });
    const items = itemsOf(await collect(svc, '697495'));
    expect(items.filter(i => i.id === 'plex:697495')).toHaveLength(1);
  });

  it('does not look up an id for non-numeric text', async () => {
    const { plex, svc } = build();
    await collect(svc, 'beethoven');
    expect(plex.getItem).not.toHaveBeenCalled();
  });

  it('a short number (2 digits) still completes cleanly when no such item exists', async () => {
    const { svc } = build({ getItem: vi.fn().mockResolvedValue(null) });
    const events = await collect(svc, '12');
    expect(itemsOf(events)).toHaveLength(0);
    expect(events.at(-1).event).toBe('complete');
  });

  it('a failing id lookup does not break the stream', async () => {
    const { svc } = build({ getItem: vi.fn().mockRejectedValue(new Error('boom')) });
    const events = await collect(svc, '697495');
    expect(events.at(-1).event).toBe('complete');
  });
});
