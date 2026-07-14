// tests/unit/content/ContentQueryService.searchStream.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService.searchStream', () => {
  let service;
  let mockRegistry;
  let mockAdapters;

  beforeEach(() => {
    // Create mock adapters with different response times
    mockAdapters = [
      {
        source: 'plex',
        search: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve({ items: [{ id: 'plex:1', title: 'Plex Result' }] }), 50))
        ),
        getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
        getQueryMappings: () => ({})
      },
      {
        source: 'immich',
        search: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve({ items: [{ id: 'immich:1', title: 'Immich Result' }] }), 100))
        ),
        getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
        getQueryMappings: () => ({})
      }
    ];

    mockRegistry = {
      resolveSource: jest.fn().mockReturnValue(mockAdapters),
      get: jest.fn().mockImplementation(source => mockAdapters.find(a => a.source === source))
    };

    service = new ContentQueryService({ registry: mockRegistry });
  });

  it('yields pending event first with all sources', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    expect(events[0].event).toBe('pending');
    expect(events[0].sources).toContain('plex');
    expect(events[0].sources).toContain('immich');
  });

  it('yields results events as each adapter completes', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    const resultEvents = events.filter(e => e.event === 'results');
    expect(resultEvents.length).toBe(2);
    // First result should be plex (faster)
    expect(resultEvents[0].source).toBe('plex');
    expect(resultEvents[0].items).toHaveLength(1);
    expect(resultEvents[0].pending).toContain('immich');
  });

  it('yields complete event last with total time', async () => {
    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(lastEvent.totalMs).toBeGreaterThan(0);
  });

  it('handles adapter errors gracefully', async () => {
    mockAdapters[0].search.mockRejectedValue(new Error('Plex down'));

    const events = [];
    for await (const event of service.searchStream({ text: 'test' })) {
      events.push(event);
    }

    // Should still get results from immich
    const resultEvents = events.filter(e => e.event === 'results');
    expect(resultEvents.some(e => e.source === 'immich')).toBe(true);
    // Should still complete
    expect(events[events.length - 1].event).toBe('complete');
  });

  it('yields source_error for a failing adapter and still completes', async () => {
    const good = {
      source: 'plex',
      search: jest.fn().mockResolvedValue({ items: [{ id: 'plex:1', title: 'A' }] }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const bad = {
      source: 'abs',
      search: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = {
      resolveSource: () => [good, bad],
      get: (s) => [good, bad].find(a => a.source === s),
    };
    const svc = new ContentQueryService({ registry });
    const events = [];
    for await (const e of svc.searchStream({ text: 'aa' })) events.push(e);
    expect(events.some(e => e.event === 'source_error' && e.source === 'abs')).toBe(true);
    expect(events.at(-1).event).toBe('complete');
  });

  it('times out a hung adapter', async () => {
    const hung = {
      source: 'slow',
      search: () => new Promise(() => {}),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = { resolveSource: () => [hung], get: () => hung };
    const svc = new ContentQueryService({ registry, adapterTimeoutMs: 50 });
    const events = [];
    for await (const e of svc.searchStream({ text: 'aa' })) events.push(e);
    expect(events.some(e => e.event === 'source_error' && /timeout/.test(e.error))).toBe(true);
  });

  it('annotates streamed items with a relevance score and sorts each batch by score', async () => {
    const adapter = {
      source: 'plex',
      search: jest.fn().mockResolvedValue({
        items: [
          // "contains" match (+5) — should sort AFTER the exact match
          { id: 'plex:2', title: 'A Hard Day\'s Night (Hey Jude session)', metadata: {} },
          // exact title match (+20) — should sort first
          { id: 'plex:1', title: 'Hey Jude', metadata: {} },
        ]
      }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = { resolveSource: () => [adapter], get: () => adapter };
    const svc = new ContentQueryService({ registry });

    const events = [];
    for await (const e of svc.searchStream({ text: 'hey jude' })) events.push(e);

    const batch = events.find(e => e.event === 'results');
    expect(batch).toBeDefined();
    // Every item carries a numeric score (additive field)
    for (const item of batch.items) {
      expect(typeof item.score).toBe('number');
    }
    // Exact title match outranks the contains match
    expect(batch.items[0].id).toBe('plex:1');
    expect(batch.items[0].score).toBeGreaterThan(batch.items[1].score);
    // Event shape is otherwise unchanged
    expect(batch.source).toBe('plex');
    expect(Array.isArray(batch.pending)).toBe(true);
  });

  it('dedupes items with the same id from the same adapter within the stream', async () => {
    const adapter = {
      source: 'files',
      search: jest.fn().mockResolvedValue({
        items: [
          { id: 'files:audio/test.mp3', title: 'test' },
          { id: 'files:audio/test.mp3', title: 'test' }, // duplicate itemId (overlapping prefix scans)
          { id: 'files:video/test.mp4', title: 'test' },
        ]
      }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = { resolveSource: () => [adapter], get: () => adapter };
    const svc = new ContentQueryService({ registry });

    const events = [];
    for await (const e of svc.searchStream({ text: 'test' })) events.push(e);

    const batch = events.find(e => e.event === 'results');
    const ids = batch.items.map(i => i.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('honours per-source timeout overrides over the default', async () => {
    const makeAdapter = (source, delayMs) => ({
      source,
      search: () => new Promise(resolve =>
        setTimeout(() => resolve({ items: [{ id: `${source}:1`, title: 'Slow Result' }] }), delayMs)
      ),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    });
    // Both adapters take 100ms. Default budget is 50ms, but 'abs' gets 500ms.
    const abs = makeAdapter('abs', 100);
    const plex = makeAdapter('plex', 100);
    const registry = {
      resolveSource: () => [abs, plex],
      get: (s) => [abs, plex].find(a => a.source === s),
    };
    const svc = new ContentQueryService({
      registry,
      adapterTimeoutMs: 50,
      sourceTimeoutsMs: { abs: 500 },
    });

    const events = [];
    for await (const e of svc.searchStream({ text: 'aa' })) events.push(e);

    // plex times out under the 50ms default…
    expect(events.some(e => e.event === 'source_error' && e.source === 'plex' && /timeout/.test(e.error))).toBe(true);
    // …but abs completes within its raised budget
    const absBatch = events.find(e => e.event === 'results' && e.source === 'abs');
    expect(absBatch).toBeDefined();
    expect(absBatch.items).toHaveLength(1);
  });

  it('batch search() times out a hung ID lookup instead of hanging the response', async () => {
    const hungLookup = {
      source: 'plex',
      getItem: () => new Promise(() => {}),                      // hangs forever
      search: jest.fn().mockResolvedValue({ items: [] }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({}),
    };
    const registry = { resolveSource: () => [hungLookup], get: () => hungLookup };
    const svc = new ContentQueryService({ registry, adapterTimeoutMs: 50, logger: { info: () => {}, warn: () => {}, debug: () => {} } });
    const result = await svc.search({ text: 'plex:123' });       // ID-like → triggers #lookupById
    expect(result.warnings?.some(w => /timeout/i.test(w.error))).toBe(true);
  }, 5000);
});
