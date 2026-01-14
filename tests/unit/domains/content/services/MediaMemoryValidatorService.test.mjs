// tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('MediaMemoryValidatorService', () => {
  let service;
  let mockPlexClient;
  let mockWatchStateStore;
  let mockLogger;

  beforeEach(() => {
    mockPlexClient = {
      request: jest.fn(),
      hubSearch: jest.fn()
    };
    mockWatchStateStore = {
      getAllOrphans: jest.fn(),
      updateId: jest.fn(),
      remove: jest.fn()
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('constructor', () => {
    it('should create service with injected dependencies', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(MediaMemoryValidatorService);
    });

    it('should use console as default logger when not provided', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore
      });

      expect(service).toBeInstanceOf(MediaMemoryValidatorService);
    });
  });

  describe('validateMediaMemory', () => {
    it('should find and backfill orphan IDs', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([
        { id: 'orphan-1', title: 'Test Movie', guid: 'plex://movie/abc123' }
      ]);

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [{ ratingKey: '12345', title: 'Test Movie', guid: 'plex://movie/abc123' }]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.backfilled).toBe(1);
      expect(mockWatchStateStore.updateId).toHaveBeenCalledWith('orphan-1', '12345');
    });

    it('should remove entries with no match', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([
        { id: 'orphan-1', title: 'Unknown Movie', year: 1990 }
      ]);

      mockPlexClient.hubSearch.mockResolvedValue({ results: [] });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.removed).toBe(1);
      expect(mockWatchStateStore.remove).toHaveBeenCalledWith('orphan-1');
    });

    it('should respect dryRun option', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([
        { id: 'orphan-1', title: 'Test Movie', guid: 'plex://movie/abc123' }
      ]);

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [{ ratingKey: '12345', title: 'Test Movie', guid: 'plex://movie/abc123' }]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory({ dryRun: true });
      expect(result.backfilled).toBe(1);
      expect(mockWatchStateStore.updateId).not.toHaveBeenCalled();
    });

    it('should limit items checked to maxItems', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      // Create 100 orphans
      const orphans = Array.from({ length: 100 }, (_, i) => ({
        id: `orphan-${i}`,
        title: `Movie ${i}`
      }));

      mockWatchStateStore.getAllOrphans.mockResolvedValue(orphans);
      mockPlexClient.hubSearch.mockResolvedValue({ results: [] });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory({ maxItems: 10 });
      expect(result.checked).toBe(10);
    });

    it('should handle errors gracefully', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([
        { id: 'orphan-1', title: 'Test Movie' }
      ]);

      mockPlexClient.hubSearch.mockRejectedValue(new Error('Plex unavailable'));

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.failed).toBe(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return complete results object', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result).toHaveProperty('checked');
      expect(result).toHaveProperty('backfilled');
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('failed');
    });
  });

  describe('selectEntriesToCheck', () => {
    it('should return all entries when fewer than maxItems', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const entries = [
        { id: '1', title: 'Movie 1' },
        { id: '2', title: 'Movie 2' }
      ];

      const selected = service.selectEntriesToCheck(entries, 10);
      expect(selected).toHaveLength(2);
    });

    it('should limit to maxItems when more entries exist', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        title: `Movie ${i}`
      }));

      const selected = service.selectEntriesToCheck(entries, 10);
      expect(selected).toHaveLength(10);
    });
  });

  describe('findBestMatch', () => {
    it('should return null when no search results', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockPlexClient.hubSearch.mockResolvedValue({ results: [] });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({ title: 'Unknown', year: 2020 });
      expect(match).toBeNull();
    });

    it('should return match with highest confidence', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [
          { ratingKey: '1', title: 'The Matrix', year: 2000 },
          { ratingKey: '2', title: 'The Matrix', year: 1999 },
          { ratingKey: '3', title: 'Matrix Revolutions', year: 2003 }
        ]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({ title: 'The Matrix', year: 1999 });
      expect(match.ratingKey).toBe('2');
    });

    it('should include confidence in match result', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [{ ratingKey: '1', title: 'The Matrix', year: 1999 }]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({ title: 'The Matrix', year: 1999 });
      expect(match).toHaveProperty('confidence');
      expect(match.confidence).toBeGreaterThan(0.8);
    });

    it('should return null when confidence below threshold', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [{ ratingKey: '1', title: 'Completely Different Movie', year: 2020 }]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({ title: 'The Matrix', year: 1999 });
      expect(match).toBeNull();
    });
  });

  describe('calculateConfidence', () => {
    it('should return high confidence for exact match', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'The Matrix', year: 1999 };
      const result = { title: 'The Matrix', year: 1999 };

      expect(service.calculateConfidence(stored, result)).toBeGreaterThan(0.9);
    });

    it('should return 1.0 for matching GUID', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'Test', guid: 'plex://movie/abc123' };
      const result = { title: 'Different Title', guid: 'plex://movie/abc123' };

      expect(service.calculateConfidence(stored, result)).toBe(1.0);
    });

    it('should return lower confidence for partial title match', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'The Matrix' };
      const result = { title: 'The Matrix Reloaded' };

      const confidence = service.calculateConfidence(stored, result);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1);
    });

    it('should reduce confidence when year mismatches', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const withMatchingYear = service.calculateConfidence(
        { title: 'The Matrix', year: 1999 },
        { title: 'The Matrix', year: 1999 }
      );

      const withMismatchedYear = service.calculateConfidence(
        { title: 'The Matrix', year: 1999 },
        { title: 'The Matrix', year: 2003 }
      );

      expect(withMatchingYear).toBeGreaterThan(withMismatchedYear);
    });

    it('should be case-insensitive for title matching', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'THE MATRIX' };
      const result = { title: 'the matrix' };

      expect(service.calculateConfidence(stored, result)).toBeGreaterThan(0.9);
    });

    it('should return 0 when no matching fields', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = {};
      const result = {};

      expect(service.calculateConfidence(stored, result)).toBe(0);
    });
  });
});
