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
});
