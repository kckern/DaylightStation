// tests/unit/content/entities/Item.test.mjs
import { Item } from '../../../../backend/src/1_domains/content/entities/Item.mjs';

describe('Item entity', () => {
  test('creates item with required fields', () => {
    const item = new Item({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Movie'
    });

    expect(item.id).toBe('plex:12345');
    expect(item.source).toBe('plex');
    expect(item.title).toBe('Test Movie');
  });

  test('includes optional fields when provided', () => {
    const item = new Item({
      id: 'filesystem:audio/song.mp3',
      source: 'filesystem',
      title: 'My Song',
      thumbnail: '/proxy/filesystem/thumb/audio/song.mp3',
      description: 'A great song',
      metadata: { artist: 'Artist Name' }
    });

    expect(item.thumbnail).toBe('/proxy/filesystem/thumb/audio/song.mp3');
    expect(item.description).toBe('A great song');
    expect(item.metadata.artist).toBe('Artist Name');
  });

  test('throws on missing required fields', () => {
    expect(() => new Item({ id: 'test' })).toThrow();
    expect(() => new Item({ source: 'plex' })).toThrow();
  });

  test('sets default values for optional fields', () => {
    const item = new Item({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Movie'
    });

    expect(item.thumbnail).toBeNull();
    expect(item.description).toBeNull();
    expect(item.metadata).toEqual({});
  });

  test('getLocalId extracts local ID from compound ID', () => {
    const item = new Item({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test Movie'
    });

    expect(item.getLocalId()).toBe('12345');
  });

  test('getLocalId handles IDs with multiple colons', () => {
    const item = new Item({
      id: 'filesystem:path/to/file:with:colons.mp3',
      source: 'filesystem',
      title: 'Test File'
    });

    expect(item.getLocalId()).toBe('path/to/file:with:colons.mp3');
  });

  test('getLocalId returns full ID if no colon present', () => {
    const item = new Item({
      id: 'simpleId',
      source: 'test',
      title: 'Test'
    });

    expect(item.getLocalId()).toBe('simpleId');
  });

  describe('action properties', () => {
    it('should support play action', () => {
      const item = new Item({
        id: 'plex:123',
        source: 'plex',
        title: 'Test',
        actions: { play: { plex: '123' } }
      });
      expect(item.actions.play).toEqual({ plex: '123' });
    });

    it('should support queue action', () => {
      const item = new Item({
        id: 'folder:tvapp',
        source: 'folder',
        title: 'TV App',
        actions: { queue: { playlist: 'tvapp' } }
      });
      expect(item.actions.queue).toEqual({ playlist: 'tvapp' });
    });

    it('should support list action', () => {
      const item = new Item({
        id: 'plex:456',
        source: 'plex',
        title: 'Shows',
        actions: { list: { plex: '456' } }
      });
      expect(item.actions.list).toEqual({ plex: '456' });
    });

    it('should default to null when no actions provided', () => {
      const item = new Item({
        id: 'plex:789',
        source: 'plex',
        title: 'No Actions'
      });
      expect(item.actions).toBeNull();
    });
  });
});
