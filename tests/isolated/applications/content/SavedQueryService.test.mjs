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
      expect(query.source).toBe('freshvideo');
      expect(query.filters.sources).toEqual(['news/world_az', 'news/cnn']);
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
