// tests/unit/content/entities/Item.test.mjs
import { Item } from '@backend/src/1_domains/content/entities/Item.mjs';

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

  describe('label property', () => {
    it('should return explicit label if provided', () => {
      const item = new Item({
        id: 'test:1',
        source: 'test',
        title: 'Full Title',
        label: 'Short'
      });
      expect(item.label).toBe('Short');
    });

    it('should fall back to title if no label', () => {
      const item = new Item({
        id: 'test:1',
        source: 'test',
        title: 'Full Title'
      });
      expect(item.label).toBe('Full Title');
    });

    it('should check metadata.label as fallback', () => {
      const item = new Item({
        id: 'test:1',
        source: 'test',
        title: 'Full Title',
        metadata: { label: 'Meta Label' }
      });
      expect(item.label).toBe('Meta Label');
    });
  });

  describe('media identifiers', () => {
    it('should extract plex key from compound ID', () => {
      const item = new Item({
        id: 'plex:12345',
        source: 'plex',
        title: 'Test'
      });
      expect(item.plex).toBe('12345');
      expect(item.media_key).toBe('plex:12345');
    });

    it('should extract filesystem path from compound ID', () => {
      const item = new Item({
        id: 'filesystem:audio/music/song.mp3',
        source: 'filesystem',
        title: 'Song'
      });
      expect(item.media_key).toBe('filesystem:audio/music/song.mp3');
    });

    it('should allow explicit media_key override', () => {
      const item = new Item({
        id: 'plex:123',
        source: 'plex',
        title: 'Test',
        media_key: 'custom-key'
      });
      expect(item.media_key).toBe('custom-key');
    });

    it('should return null for plex if not a plex item', () => {
      const item = new Item({
        id: 'filesystem:test.mp3',
        source: 'filesystem',
        title: 'Test'
      });
      expect(item.plex).toBeNull();
    });

    it('should check metadata.plex as fallback', () => {
      const item = new Item({
        id: 'folder:tvapp',
        source: 'folder',
        title: 'Test',
        metadata: { plex: '99999' }
      });
      expect(item.plex).toBe('99999');
    });
  });
});
