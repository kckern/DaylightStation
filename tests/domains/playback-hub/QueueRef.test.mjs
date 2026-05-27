import { describe, it, expect } from 'vitest';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('QueueRef', () => {
  describe('constructor', () => {
    it('accepts { source, id }', () => {
      const q = new QueueRef({ source: 'plex', id: '670208' });
      expect(q.source).toBe('plex');
      expect(q.id).toBe('670208');
    });

    it('rejects empty id', () => {
      expect(() => new QueueRef({ source: 'plex', id: '' })).toThrow(ValidationError);
    });
    it('rejects non-string id', () => {
      expect(() => new QueueRef({ source: 'plex', id: 670208 })).toThrow(ValidationError);
      expect(() => new QueueRef({ source: 'plex', id: null })).toThrow(ValidationError);
      expect(() => new QueueRef({ source: 'plex', id: undefined })).toThrow(ValidationError);
    });
    it('rejects empty source', () => {
      expect(() => new QueueRef({ source: '', id: '670208' })).toThrow(ValidationError);
    });
    it('rejects non-string source', () => {
      expect(() => new QueueRef({ source: 42, id: '670208' })).toThrow(ValidationError);
      expect(() => new QueueRef({ source: null, id: '670208' })).toThrow(ValidationError);
    });
  });

  describe('toString', () => {
    it('formats as source:id', () => {
      expect(new QueueRef({ source: 'plex', id: '670208' }).toString()).toBe('plex:670208');
      expect(new QueueRef({ source: 'spotify', id: 'abc' }).toString()).toBe('spotify:abc');
    });
  });

  describe('parse (static)', () => {
    it('parses "plex:670208" into { source:plex, id:670208 }', () => {
      const q = QueueRef.parse('plex:670208');
      expect(q.source).toBe('plex');
      expect(q.id).toBe('670208');
    });
    it('parses "670208" (no colon) defaulting source=plex', () => {
      const q = QueueRef.parse('670208');
      expect(q.source).toBe('plex');
      expect(q.id).toBe('670208');
    });
    it('keeps subsequent colons inside the id', () => {
      const q = QueueRef.parse('spotify:track:abc:def');
      expect(q.source).toBe('spotify');
      expect(q.id).toBe('track:abc:def');
    });
    it('rejects empty string', () => {
      expect(() => QueueRef.parse('')).toThrow(ValidationError);
    });
    it('rejects non-string', () => {
      expect(() => QueueRef.parse(null)).toThrow(ValidationError);
      expect(() => QueueRef.parse(670208)).toThrow(ValidationError);
    });
    it('rejects "plex:" with empty id', () => {
      expect(() => QueueRef.parse('plex:')).toThrow(ValidationError);
    });
    it('rejects ":670208" with empty source', () => {
      expect(() => QueueRef.parse(':670208')).toThrow(ValidationError);
    });
  });

  describe('equals', () => {
    it('equals when source AND id match', () => {
      expect(new QueueRef({ source: 'plex', id: '670208' })
        .equals(new QueueRef({ source: 'plex', id: '670208' }))).toBe(true);
    });
    it('not equal when source differs', () => {
      expect(new QueueRef({ source: 'plex', id: '1' })
        .equals(new QueueRef({ source: 'spotify', id: '1' }))).toBe(false);
    });
    it('not equal when id differs', () => {
      expect(new QueueRef({ source: 'plex', id: '1' })
        .equals(new QueueRef({ source: 'plex', id: '2' }))).toBe(false);
    });
    it('returns false for non-QueueRef', () => {
      expect(new QueueRef({ source: 'plex', id: '1' }).equals(null)).toBe(false);
      expect(new QueueRef({ source: 'plex', id: '1' }).equals('plex:1')).toBe(false);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new QueueRef({ source: 'plex', id: '1' }))).toBe(true);
  });

  it('toJSON returns { source, id } shape', () => {
    const q = new QueueRef({ source: 'plex', id: '670208' });
    expect(q.toJSON()).toEqual({ source: 'plex', id: '670208' });
  });
});
