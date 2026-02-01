// tests/isolated/api/parsers/contentQueryParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseContentQuery, validateContentQuery, QUERY_ALIASES } from '#api/v1/parsers/contentQueryParser.mjs';

describe('contentQueryParser', () => {
  describe('parseContentQuery', () => {
    it('parses source with alias', () => {
      const result = parseContentQuery({ source: 'photos' });
      expect(result.source).toBe('gallery');
    });

    it('parses source without alias', () => {
      const result = parseContentQuery({ source: 'plex' });
      expect(result.source).toBe('plex');
    });

    it('normalizes shuffle to sort=random', () => {
      const result = parseContentQuery({ shuffle: '1' });
      expect(result.sort).toBe('random');
    });

    it('normalizes sort=shuffle to sort=random', () => {
      const result = parseContentQuery({ sort: 'shuffle' });
      expect(result.sort).toBe('random');
    });

    it('parses favorites boolean param', () => {
      const result = parseContentQuery({ favorites: 'true' });
      expect(result.favorites).toBe(true);
    });

    it('parses pagination params as numbers', () => {
      const result = parseContentQuery({ take: '10', skip: '5' });
      expect(result.take).toBe(10);
      expect(result.skip).toBe(5);
    });

    it('passes through canonical keys', () => {
      const result = parseContentQuery({
        text: 'test',
        person: 'alice',
        creator: 'bob'
      });
      expect(result.text).toBe('test');
      expect(result.person).toBe('alice');
      expect(result.creator).toBe('bob');
    });

    it('passes through adapter-specific keys (prefix.key)', () => {
      const result = parseContentQuery({ 'immich.location': 'NYC' });
      expect(result['immich.location']).toBe('NYC');
    });

    it('parses pick param', () => {
      const result = parseContentQuery({ pick: 'random' });
      expect(result.pick).toBe('random');
    });

    it('parses from param', () => {
      const result = parseContentQuery({ from: 'playlists' });
      expect(result.from).toBe('playlists');
    });
  });

  describe('validateContentQuery', () => {
    it('validates correct query', () => {
      const result = validateContentQuery({
        source: 'plex',
        sort: 'date',
        take: 10
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid sort option', () => {
      const result = validateContentQuery({ sort: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('sort');
    });

    it('rejects invalid mediaType', () => {
      const result = validateContentQuery({ mediaType: 'pdf' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('mediaType');
    });

    it('rejects invalid capability', () => {
      const result = validateContentQuery({ capability: 'downloadable' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('capability');
    });

    it('rejects invalid pick option', () => {
      const result = validateContentQuery({ pick: 'first' });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('pick');
    });

    it('validates duration format', () => {
      const valid = validateContentQuery({ duration: '3m..10m' });
      expect(valid.valid).toBe(true);

      const invalid = validateContentQuery({ duration: 'abc' });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors[0].field).toBe('duration');
    });

    it('rejects take less than 1', () => {
      const result = validateContentQuery({ take: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('take');
    });

    it('rejects take greater than 1000', () => {
      const result = validateContentQuery({ take: 1001 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('take');
    });

    it('rejects negative skip', () => {
      const result = validateContentQuery({ skip: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('skip');
    });
  });

  describe('QUERY_ALIASES', () => {
    it('has sort aliases', () => {
      expect(QUERY_ALIASES.sort.shuffle).toBe('random');
      expect(QUERY_ALIASES.sort.rand).toBe('random');
    });

    it('has source aliases', () => {
      expect(QUERY_ALIASES.source.photos).toBe('gallery');
      expect(QUERY_ALIASES.source.videos).toBe('media');
      expect(QUERY_ALIASES.source.books).toBe('readable');
    });
  });

  describe('parseContentQuery - duration parsing', () => {
    it('parses simple duration to seconds', () => {
      const result = parseContentQuery({ duration: '3m' });
      expect(result.duration).toEqual({ value: 180 });
    });

    it('parses duration range to from/to seconds', () => {
      const result = parseContentQuery({ duration: '3m..10m' });
      expect(result.duration).toEqual({ from: 180, to: 600 });
    });

    it('parses open-ended duration range', () => {
      const result = parseContentQuery({ duration: '..5m' });
      expect(result.duration).toEqual({ from: null, to: 300 });
    });
  });

  describe('parseContentQuery - time parsing', () => {
    it('parses year to date range', () => {
      const result = parseContentQuery({ time: '2025' });
      expect(result.time).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });

    it('parses year-month to date range', () => {
      const result = parseContentQuery({ time: '2025-06' });
      expect(result.time).toEqual({ from: '2025-06-01', to: '2025-06-30' });
    });

    it('parses year range', () => {
      const result = parseContentQuery({ time: '2024..2025' });
      expect(result.time).toEqual({ from: '2024-01-01', to: '2025-12-31' });
    });
  });
});
