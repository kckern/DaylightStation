import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('mediaMemory helpers', () => {
  let mediaMemory;

  beforeAll(async () => {
    // Set test data path before importing
    const testDataPath = path.join(__dirname, '../_fixtures/data');
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    mediaMemory = await import('#backend/_legacy/lib/mediaMemory.mjs');
  });

  describe('parseLibraryFilename', () => {
    it('parses ID and name from filename', () => {
      const result = mediaMemory.parseLibraryFilename('14_fitness.yml');
      expect(result).toEqual({ libraryId: 14, libraryName: 'fitness' });
    });

    it('returns null for legacy filename without ID', () => {
      const result = mediaMemory.parseLibraryFilename('fitness.yml');
      expect(result).toBeNull();
    });

    it('handles names with underscores', () => {
      const result = mediaMemory.parseLibraryFilename('2_tv_shows.yml');
      expect(result).toEqual({ libraryId: 2, libraryName: 'tv_shows' });
    });

    it('handles yaml extension', () => {
      const result = mediaMemory.parseLibraryFilename('5_movies.yaml');
      expect(result).toEqual({ libraryId: 5, libraryName: 'movies' });
    });

    it('returns null for non-matching patterns', () => {
      expect(mediaMemory.parseLibraryFilename('_archive')).toBeNull();
      expect(mediaMemory.parseLibraryFilename('somefile.txt')).toBeNull();
      expect(mediaMemory.parseLibraryFilename('')).toBeNull();
    });
  });

  describe('buildLibraryFilename', () => {
    it('builds filename from ID and name', () => {
      const result = mediaMemory.buildLibraryFilename(14, 'fitness');
      expect(result).toBe('14_fitness.yml');
    });

    it('slugifies name with spaces', () => {
      const result = mediaMemory.buildLibraryFilename(1, 'My Movies');
      expect(result).toBe('1_my-movies.yml');
    });

    it('slugifies name with special characters', () => {
      const result = mediaMemory.buildLibraryFilename(3, "TV Shows & More!");
      expect(result).toBe('3_tv-shows-more.yml');
    });

    it('handles already lowercase names', () => {
      const result = mediaMemory.buildLibraryFilename(7, 'music');
      expect(result).toBe('7_music.yml');
    });
  });

  describe('getMediaMemoryFiles', () => {
    it('exports the function', () => {
      expect(typeof mediaMemory.getMediaMemoryFiles).toBe('function');
    });

    // Note: More detailed tests for getMediaMemoryFiles would require
    // setting up fixture directories and ConfigService initialization.
    // Skipping until ConfigService migration is complete.
    it.skip('returns empty array for non-existent plex directory', () => {
      // With fixture data that doesn't have plex dir, should return empty array
      // TODO: Requires ConfigService initialization - test after migration
      const result = mediaMemory.getMediaMemoryFiles('_test');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
