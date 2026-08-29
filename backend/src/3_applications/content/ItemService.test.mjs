import { describe, expect, it, vi } from 'vitest';
import { ItemService } from './ItemService.mjs';

describe('ItemService', () => {
  it('owns content-source lookup and recent-menu ordering outside the API', async () => {
    const contentCatalog = {
      resolveSource: () => ({ source: 'plex', localId: 'show' }),
      getItem: vi.fn(async () => ({ id: 'plex:show', title: 'Show', itemType: 'container' })),
      getList: vi.fn(async () => ({ children: [
        { id: 'old', actions: { play: { id: 'old-key' } } },
        { id: 'new', actions: { play: { id: 'new-key' } } },
      ] })),
      getContainerInfo: vi.fn(async () => null),
    };
    const service = new ItemService({
      contentCatalog,
      menuMemory: { getAll: () => ({ 'old-key': 1, 'new-key': 2 }), record: vi.fn() },
    });
    const outcome = await service.get({
      source: 'plex', localId: 'show',
      modifiers: { playable: false, shuffle: false, recent_on_top: true },
    });
    expect(outcome.kind).toBe('container');
    expect(outcome.items.map((item) => item.id)).toEqual(['new', 'old']);
    expect(contentCatalog.getItem).toHaveBeenCalledWith({ source: 'plex', localId: 'show' }, 'plex:show');
  });

  it('preserves the menu-memory stored shape', () => {
    const record = vi.fn((key, value) => ({ [key]: value }));
    const service = new ItemService({
      contentCatalog: { getItem: vi.fn() }, menuMemory: { getAll: () => ({}), record }, clock: () => 12_345,
    });
    expect(service.recordMenuSelection('plex:1')).toEqual({ 'plex:1': 12 });
    expect(record).toHaveBeenCalledWith('plex:1', 12);
  });
});
