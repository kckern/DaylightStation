// tests/isolated/applications/content/SavedQueryService.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { SavedQueryService } from '#apps/content/SavedQueryService.mjs';

describe('SavedQueryService', () => {
  let service;
  const queries = {
    dailynews: { type: 'freshvideo', sources: ['news/world_az', 'news/cnn'] },
    morning: { type: 'freshvideo', sources: ['teded', 'science'], title: 'Morning Science' },
  };

  beforeEach(() => {
    service = new SavedQueryService({
      readQuery: (name) => queries[name] || null,
    });
  });

  describe('getQuery', () => {
    it('returns normalized query definition', () => {
      const query = service.getQuery('dailynews');
      expect(query).not.toBeNull();
      expect(query.title).toBe('dailynews');
      expect(query.items[0].source).toBe('freshvideo');
      expect(query.items[0].filters.sources).toEqual(['news/world_az', 'news/cnn']);
    });

    it('uses title from YAML if present', () => {
      const query = service.getQuery('morning');
      expect(query.title).toBe('Morning Science');
    });

    it('returns null for unknown query', () => {
      expect(service.getQuery('nonexistent')).toBeNull();
    });

    it('handles null readQuery result', () => {
      const svc = new SavedQueryService({ readQuery: () => null });
      expect(svc.getQuery('anything')).toBeNull();
    });

    it('passes through exclude array when present', () => {
      const svc = new SavedQueryService({
        readQuery: () => ({ type: 'immich', exclude: ['uuid-1', 'uuid-2'] }),
      });
      const query = svc.getQuery('test');
      expect(query.items[0].exclude).toEqual(['uuid-1', 'uuid-2']);
    });

    it('omits exclude when not present', () => {
      const query = service.getQuery('dailynews');
      expect(query.items[0]).not.toHaveProperty('exclude');
    });

    it('passes through slideshow config when present', () => {
      const slideshow = { duration: 5, effect: 'kenburns', zoom: 1.2, transition: 'crossfade', focusPerson: 'Felix' };
      const svc = new SavedQueryService({
        readQuery: () => ({ type: 'immich', slideshow }),
      });
      const query = svc.getQuery('test');
      expect(query.items[0].slideshow).toEqual(slideshow);
    });

    it('omits slideshow when not present', () => {
      const query = service.getQuery('dailynews');
      expect(query.items[0]).not.toHaveProperty('slideshow');
    });

    it('passes through audio config when present', () => {
      const audio = { contentId: 'music:anniversary', behavior: 'pause', mode: 'hidden' };
      const svc = new SavedQueryService({
        readQuery: () => ({ type: 'immich', audio }),
      });
      const query = svc.getQuery('test');
      expect(query.audio).toEqual(audio);
    });

    it('omits audio when not present', () => {
      const query = service.getQuery('dailynews');
      expect(query).not.toHaveProperty('audio');
    });

    it('wraps flat query into single-element items array', () => {
      const result = service.getQuery('dailynews');
      expect(result.items).toEqual([{
        source: 'freshvideo',
        filters: { sources: ['news/world_az', 'news/cnn'] },
        params: {},
      }]);
    });

    it('returns items array from composite query', () => {
      queries.anniversary = {
        title: 'Anniversary',
        items: [
          { type: 'titlecard', template: 'centered', duration: 6, text: { title: 'Hello' } },
          { type: 'immich', params: { month: 3, day: 4 } },
          { query: 'dailynews' },
        ],
      };
      const result = service.getQuery('anniversary');
      expect(result.items).toHaveLength(3);
      expect(result.items[0].type).toBe('titlecard');
      expect(result.items[1].type).toBe('immich');
      expect(result.items[2].query).toBe('dailynews');
    });

    it('preserves root-level audio on composite query', () => {
      queries.anniversary = {
        title: 'Anniversary',
        audio: { contentId: 'music:test', behavior: 'pause' },
        items: [
          { type: 'immich', params: { month: 3 } },
        ],
      };
      const result = service.getQuery('anniversary');
      expect(result.audio).toEqual({ contentId: 'music:test', behavior: 'pause' });
    });

    it('flat titlecard query normalizes into items array', () => {
      queries.welcome = {
        title: 'Welcome',
        type: 'titlecard',
        template: 'centered',
        duration: 10,
        text: { title: 'Welcome' },
      };
      const result = service.getQuery('welcome');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe('titlecard');
      expect(result.items[0].template).toBe('centered');
    });
  });

  describe('listQueries', () => {
    it('delegates to listFn and returns names', () => {
      const svc = new SavedQueryService({
        readQuery: () => null,
        listQueries: () => ['dailynews', 'morning'],
      });
      expect(svc.listQueries()).toEqual(['dailynews', 'morning']);
    });

    it('returns empty array if no listFn provided', () => {
      expect(service.listQueries()).toEqual([]);
    });
  });

  describe('saveQuery', () => {
    it('delegates to writeFn', () => {
      let saved = null;
      const svc = new SavedQueryService({
        readQuery: () => null,
        writeQuery: (name, data) => { saved = { name, data }; },
      });
      svc.saveQuery('test', { type: 'freshvideo', sources: ['news/bbc'] });
      expect(saved.name).toBe('test');
      expect(saved.data.type).toBe('freshvideo');
      expect(saved.data.sources).toEqual(['news/bbc']);
    });

    it('throws if no writeFn provided', () => {
      expect(() => service.saveQuery('test', {})).toThrow();
    });
  });

  describe('deleteQuery', () => {
    it('delegates to deleteFn', () => {
      let deleted = null;
      const svc = new SavedQueryService({
        readQuery: () => null,
        deleteQuery: (name) => { deleted = name; },
      });
      svc.deleteQuery('dailynews');
      expect(deleted).toBe('dailynews');
    });

    it('throws if no deleteFn provided', () => {
      expect(() => service.deleteQuery('test')).toThrow();
    });
  });
});
