// tests/unit/content/capabilities/Listable.test.mjs
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';

describe('Listable capability', () => {
  test('creates listable item with itemType', () => {
    const item = new ListableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'TV Show',
      itemType: 'container',
      childCount: 5
    });

    expect(item.itemType).toBe('container');
    expect(item.childCount).toBe(5);
    expect(item.isContainer()).toBe(true);
  });

  test('leaf items have no children', () => {
    const item = new ListableItem({
      id: 'plex:67890',
      source: 'plex',
      title: 'Episode',
      itemType: 'leaf'
    });

    expect(item.itemType).toBe('leaf');
    expect(item.isContainer()).toBe(false);
  });

  test('inherits from Item base class', () => {
    const item = new ListableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Item',
      itemType: 'leaf'
    });

    // Should have Item properties
    expect(item.id).toBe('plex:12345');
    expect(item.source).toBe('plex');
    expect(item.title).toBe('Test Item');
    expect(item.getLocalId()).toBe('12345');
  });

  test('defaults childCount and sortOrder to 0', () => {
    const item = new ListableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Item',
      itemType: 'container'
    });

    expect(item.childCount).toBe(0);
    expect(item.sortOrder).toBe(0);
  });

  test('accepts sortOrder for ordering in lists', () => {
    const item = new ListableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Item',
      itemType: 'leaf',
      sortOrder: 5
    });

    expect(item.sortOrder).toBe(5);
  });
});
