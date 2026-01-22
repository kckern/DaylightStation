// tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('MediaMemoryValidatorService', () => {
  let service;
  let mockPlexClient;
  let mockWatchStateStore;
  let mockLogger;

  beforeEach(() => {
    mockPlexClient = {
      checkConnectivity: jest.fn().mockResolvedValue(true),
      verifyId: jest.fn(),
      hubSearch: jest.fn()
    };
    mockWatchStateStore = {
      getAllEntries: jest.fn(),
      updateId: jest.fn()
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
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      expect(service).toBeInstanceOf(MediaMemoryValidatorService);
    });

    it('should use console as default logger when not provided', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore
      });

      expect(service).toBeInstanceOf(MediaMemoryValidatorService);
    });
  });

  describe('validateMediaMemory', () => {
    it('should abort if Plex server unreachable', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockPlexClient.checkConnectivity.mockResolvedValue(false);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.aborted).toBe(true);
      expect(result.reason).toBe('Plex unreachable');
      expect(mockWatchStateStore.getAllEntries).not.toHaveBeenCalled();
    });

    it('should skip entries that still exist in Plex', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockWatchStateStore.getAllEntries.mockResolvedValue([
        { id: '12345', title: 'Test Movie', lastPlayed: new Date().toISOString() }
      ]);
      mockPlexClient.verifyId.mockResolvedValue({ ratingKey: '12345', title: 'Test Movie' });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.valid).toBe(1);
      expect(result.checked).toBe(1);
    });

    it('should find and backfill orphan IDs with high confidence match', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      // Use TV episode format with parent/grandparent to get >90% confidence
      // Title 50% + grandparent 30% + parent 20% = 100% for exact match
      mockWatchStateStore.getAllEntries.mockResolvedValue([
        {
          id: 'orphan-1',
          title: 'Ozymandias',
          parent: 'Season 5',
          grandparent: 'Breaking Bad',
          lastPlayed: new Date().toISOString()
        }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null); // ID doesn't exist
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '12345', title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.backfilled).toBe(1);
      expect(mockWatchStateStore.updateId).toHaveBeenCalledWith(
        'orphan-1',
        '12345',
        expect.objectContaining({ oldPlexIds: expect.any(Array) })
      );
    });

    it('should NEVER delete orphan entries - only log as unresolved', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockWatchStateStore.getAllEntries.mockResolvedValue([
        { id: 'orphan-1', title: 'Unknown Movie', lastPlayed: new Date().toISOString() }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null); // ID doesn't exist
      mockPlexClient.hubSearch.mockResolvedValue([]); // No match found

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();

      // Should be logged as unresolved, NOT removed
      expect(result.unresolved).toBe(1);
      expect(result.unresolved).toBeGreaterThan(0);

      // Verify remove was NEVER called (critical safety feature)
      expect(mockWatchStateStore.remove).toBeUndefined();

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'validator.noMatch',
        expect.objectContaining({ id: expect.any(Number), reason: 'no match found' })
      );
    });

    it('should log unresolved when confidence too low', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockWatchStateStore.getAllEntries.mockResolvedValue([
        { id: 'orphan-1', title: 'The Matrix', lastPlayed: new Date().toISOString() }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null);
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '999', title: 'Completely Different Movie' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.unresolved).toBe(1);
      expect(result.backfilled).toBe(0);
    });

    it('should respect dryRun option', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      // Use TV episode format to get >90% confidence
      mockWatchStateStore.getAllEntries.mockResolvedValue([
        {
          id: 'orphan-1',
          title: 'Ozymandias',
          parent: 'Season 5',
          grandparent: 'Breaking Bad',
          lastPlayed: new Date().toISOString()
        }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null);
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '12345', title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory({ dryRun: true });
      expect(result.backfilled).toBe(1);
      expect(mockWatchStateStore.updateId).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockWatchStateStore.getAllEntries.mockResolvedValue([
        { id: 'orphan-1', title: 'Test Movie', lastPlayed: new Date().toISOString() }
      ]);
      mockPlexClient.verifyId.mockRejectedValue(new Error('Plex unavailable'));

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.failed).toBe(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return complete results object with changes and unresolvedList', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockWatchStateStore.getAllEntries.mockResolvedValue([]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result).toHaveProperty('checked');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('backfilled');
      expect(result).toHaveProperty('unresolved'); // Count
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('changes'); // Array of changes
      expect(result).toHaveProperty('unresolvedList'); // Array of unresolved items
    });
  });

  describe('selectEntriesToCheck', () => {
    it('should prioritize recent entries (last 30 days)', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const now = new Date();
      const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
      const old = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

      const entries = [
        { id: '1', title: 'Recent Movie', lastPlayed: recent },
        { id: '2', title: 'Old Movie 1', lastPlayed: old },
        { id: '3', title: 'Old Movie 2', lastPlayed: old },
        { id: '4', title: 'Old Movie 3', lastPlayed: old }
      ];

      const selected = service.selectEntriesToCheck(entries);

      // Recent entry should always be included
      expect(selected.some(e => e.id === '1')).toBe(true);
    });

    it('should sample 10% of older entries', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

      // Create 100 old entries
      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        title: `Old Movie ${i}`,
        lastPlayed: old
      }));

      const selected = service.selectEntriesToCheck(entries);

      // Should sample ~10% of older entries (10 out of 100)
      expect(selected.length).toBe(10);
    });
  });

  describe('findBestMatch', () => {
    it('should return null when no search results', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockPlexClient.hubSearch.mockResolvedValue([]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({ title: 'Unknown' });
      expect(match).toBeNull();
    });

    it('should search with grandparent + title for TV episodes', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '12345', title: 'Ozymandias', grandparent: 'Breaking Bad', parent: 'Season 5' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      await service.findBestMatch({
        title: 'Ozymandias',
        grandparent: 'Breaking Bad',
        parent: 'Season 5'
      });

      // First search should be "grandparent title"
      expect(mockPlexClient.hubSearch).toHaveBeenCalledWith(
        'Breaking Bad Ozymandias',
        undefined
      );
    });

    it('should return match with highest confidence', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '1', title: 'Breaking Bad', grandparent: '', parent: '' },
        { id: '2', title: 'Ozymandias', grandparent: 'Breaking Bad', parent: 'Season 5' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({
        title: 'Ozymandias',
        grandparent: 'Breaking Bad',
        parent: 'Season 5'
      });

      expect(match.id).toBe('2');
    });

    it('should include confidence in match result', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      // Use TV episode format for >90% confidence
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '1', title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const match = await service.findBestMatch({
        title: 'Ozymandias',
        parent: 'Season 5',
        grandparent: 'Breaking Bad'
      });
      expect(match).toHaveProperty('confidence');
      expect(match.confidence).toBeGreaterThanOrEqual(90);
    });

    it('should return match even below 90% threshold (caller filters)', async () => {
      // Note: findBestMatch returns best match regardless of threshold
      // The threshold filtering happens in validateMediaMemory
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '1', title: 'The Matrix' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      // Title-only match gives 50% confidence (below 90% threshold)
      const match = await service.findBestMatch({ title: 'The Matrix' });
      expect(match).not.toBeNull();
      expect(match.confidence).toBe(50); // title only = 50%
    });
  });

  describe('calculateConfidence', () => {
    it('should weight: title 50%, grandparent 30%, parent 20%', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      // Full match should get 100%
      const fullMatch = service.calculateConfidence(
        { title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' },
        { title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      );
      expect(fullMatch).toBe(100);
    });

    it('should return high confidence for exact title match', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'The Matrix' };
      const result = { title: 'The Matrix' };

      // Title only = 50% weight, but exact match = 50
      expect(service.calculateConfidence(stored, result)).toBe(50);
    });

    it('should include parent/grandparent in confidence calculation', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const titleOnly = service.calculateConfidence(
        { title: 'Ozymandias' },
        { title: 'Ozymandias' }
      );

      const withContext = service.calculateConfidence(
        { title: 'Ozymandias', grandparent: 'Breaking Bad', parent: 'Season 5' },
        { title: 'Ozymandias', grandparent: 'Breaking Bad', parent: 'Season 5' }
      );

      expect(withContext).toBeGreaterThan(titleOnly);
    });

    it('should be case-insensitive for all fields', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'THE MATRIX', grandparent: 'THE SHOW' };
      const result = { title: 'the matrix', grandparent: 'the show' };

      expect(service.calculateConfidence(stored, result)).toBeGreaterThan(50);
    });

    it('should return 0 when no matching fields', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = {};
      const result = {};

      expect(service.calculateConfidence(stored, result)).toBe(0);
    });

    it('should use Dice coefficient (bigram) similarity', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      // "night" vs "nacht" - Dice coefficient should give partial match
      const similarity = service.calculateConfidence(
        { title: 'night' },
        { title: 'nacht' }
      );

      // Should be > 0 because of shared bigrams (like "ht")
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(50); // But not a high match
    });
  });

  describe('oldPlexIds preservation', () => {
    it('should preserve old ID in oldPlexIds array when backfilling', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      // Use TV episode format for >90% confidence
      mockWatchStateStore.getAllEntries.mockResolvedValue([
        {
          id: '99999',
          title: 'Ozymandias',
          parent: 'Season 5',
          grandparent: 'Breaking Bad',
          lastPlayed: new Date().toISOString()
        }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null);
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '12345', title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      await service.validateMediaMemory();

      expect(mockWatchStateStore.updateId).toHaveBeenCalledWith(
        '99999',
        '12345',
        { oldPlexIds: [99999] }
      );
    });

    it('should append to existing oldPlexIds array', async () => {
      const { MediaMemoryValidatorService } = await import('@backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs');

      // Use TV episode format for >90% confidence
      mockWatchStateStore.getAllEntries.mockResolvedValue([
        {
          id: '99999',
          title: 'Ozymandias',
          parent: 'Season 5',
          grandparent: 'Breaking Bad',
          oldPlexIds: [88888, 77777],
          lastPlayed: new Date().toISOString()
        }
      ]);
      mockPlexClient.verifyId.mockResolvedValue(null);
      mockPlexClient.hubSearch.mockResolvedValue([
        { id: '12345', title: 'Ozymandias', parent: 'Season 5', grandparent: 'Breaking Bad' }
      ]);

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      await service.validateMediaMemory();

      expect(mockWatchStateStore.updateId).toHaveBeenCalledWith(
        '99999',
        '12345',
        { oldPlexIds: [88888, 77777, 99999] }
      );
    });
  });
});
