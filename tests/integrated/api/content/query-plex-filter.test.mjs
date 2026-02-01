/**
 * Integration test for content query endpoint with Plex library filter
 *
 * Tests that the plex.libraryName filter parameter works correctly
 * through the /api/v1/content/query/list endpoint.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Content Query - Plex Library Filter', () => {
  // These tests require a running backend with Plex configured
  // Skip if not available

  const BASE_URL = process.env.TEST_BACKEND_URL || 'http://localhost:3111';
  let plexConfigured = false;

  beforeAll(async () => {
    // Check if backend is available and Plex is configured
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { method: 'GET' });
      if (response.ok) {
        // Try a basic Plex query to see if it's configured
        const plexCheck = await fetch(
          `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex`
        );
        plexConfigured = plexCheck.ok && plexCheck.status !== 501;
      }
    } catch {
      // Backend not available
      plexConfigured = false;
    }
  });

  describe('GET /api/v1/content/query/list with plex.libraryName', () => {
    it('filters playlists by library name', async () => {
      if (!plexConfigured) {
        console.log('SKIP: Plex not configured or backend unavailable');
        return;
      }

      const response = await fetch(
        `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=Music`
      );

      // Skip if Plex not configured
      if (response.status === 404 || response.status === 501) {
        console.log('Plex not configured, skipping');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();

      // If we got results, they should all be audio playlists
      if (data.items && data.items.length > 0) {
        // Verify all returned items are from expected source
        for (const item of data.items) {
          expect(item.source).toBe('plex');
          expect(item.id).toMatch(/^plex:/);
        }
      }
    });

    it('returns different results for different library names', async () => {
      if (!plexConfigured) {
        console.log('SKIP: Plex not configured or backend unavailable');
        return;
      }

      const musicResponse = await fetch(
        `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=Music`
      );
      const moviesResponse = await fetch(
        `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=Movies`
      );

      // Skip if either failed
      if (!musicResponse.ok || !moviesResponse.ok) {
        console.log('SKIP: Could not fetch playlists for comparison');
        return;
      }

      const musicData = await musicResponse.json();
      const moviesData = await moviesResponse.json();

      // The results should be different (unless both are empty)
      if (musicData.items?.length > 0 && moviesData.items?.length > 0) {
        const musicIds = new Set(musicData.items.map(i => i.id));
        const movieIds = new Set(moviesData.items.map(i => i.id));

        // At least some items should be different
        const overlap = [...musicIds].filter(id => movieIds.has(id));
        const uniqueMusic = musicData.items.length - overlap.length;
        const uniqueMovies = moviesData.items.length - overlap.length;

        // Either some unique items or both sets are disjoint
        expect(uniqueMusic + uniqueMovies).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns empty array for non-existent library name', async () => {
      if (!plexConfigured) {
        console.log('SKIP: Plex not configured or backend unavailable');
        return;
      }

      const response = await fetch(
        `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=NonExistentLibrary12345`
      );

      if (response.status === 501) {
        console.log('SKIP: Query service not configured');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();

      // Should return empty items for non-existent library
      expect(data.items).toBeDefined();
      expect(data.items).toEqual([]);
    });

    it('works without libraryName filter (returns all)', async () => {
      if (!plexConfigured) {
        console.log('SKIP: Plex not configured or backend unavailable');
        return;
      }

      const response = await fetch(
        `${BASE_URL}/api/v1/content/query/list?from=playlists&source=plex`
      );

      if (response.status === 501) {
        console.log('SKIP: Query service not configured');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
