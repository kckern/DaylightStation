// tests/isolated/api/parsers/contentQueryParser.test.mjs
import { describe, it, expect } from '@jest/globals';
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
        time: '2025'
      });
      expect(result.text).toBe('test');
      expect(result.person).toBe('alice');
      expect(result.time).toBe('2025');
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
});
