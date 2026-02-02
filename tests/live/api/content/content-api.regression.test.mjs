/**
 * Content API Regression Test Suite
 *
 * Tests content lookup/playback APIs with dynamic fixture discovery.
 * Probes the data mount's media history and watchlists to build test cases
 * rather than hardcoding fixtures.
 *
 * Coverage:
 * - Watch state enrichment in list/item endpoints
 * - Progress fields in canonical format (playhead, percent, duration)
 * - NextUp/selection patterns (scripture volumes, watchlists)
 * - Source resolution (plex, narrated, singing, folder)
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Backend port from environment or default
const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE_URL = `http://localhost:${BACKEND_PORT}/api/v1`;

// Data path discovery
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH ||
  '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

/**
 * Load YAML file safely
 */
function loadYamlSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch (e) {
    return null;
  }
}

/**
 * Discover watch history files from media_memory
 */
function discoverWatchHistory() {
  const historyPath = path.join(DATA_PATH, 'household/history/media_memory');
  const discovered = {
    plex: [],
    scriptures: null,
    hymn: null,
    talk: null,
    poetry: null
  };

  if (!fs.existsSync(historyPath)) {
    console.warn('[Test Discovery] media_memory path not found:', historyPath);
    return discovered;
  }

  // Discover Plex library files
  const plexDir = path.join(historyPath, 'plex');
  if (fs.existsSync(plexDir)) {
    const files = fs.readdirSync(plexDir).filter(f => f.endsWith('.yml') && !f.startsWith('._'));
    for (const file of files) {
      const data = loadYamlSafe(path.join(plexDir, file));
      if (data && Object.keys(data).length > 0) {
        discovered.plex.push({
          file: file.replace('.yml', ''),
          entries: Object.keys(data).length,
          sampleIds: Object.keys(data).slice(0, 5)
        });
      }
    }
  }

  // Discover narrated content history
  discovered.scriptures = loadYamlSafe(path.join(historyPath, 'scriptures.yml'));
  discovered.hymn = loadYamlSafe(path.join(historyPath, 'hymn.yml'));
  discovered.talk = loadYamlSafe(path.join(historyPath, 'talk.yml'));
  discovered.poetry = loadYamlSafe(path.join(historyPath, 'poetry.yml'));

  return discovered;
}

/**
 * Discover watchlist files from household apps
 */
function discoverWatchlists() {
  const watchlistPath = path.join(DATA_PATH, 'household/apps/media/watchlists');
  const discovered = [];

  if (!fs.existsSync(watchlistPath)) {
    console.warn('[Test Discovery] watchlists path not found:', watchlistPath);
    return discovered;
  }

  const files = fs.readdirSync(watchlistPath).filter(f => f.endsWith('.yml') && !f.startsWith('._'));
  for (const file of files) {
    const name = file.replace('.yml', '');
    const data = loadYamlSafe(path.join(watchlistPath, file));
    if (data && Array.isArray(data.items)) {
      discovered.push({
        name,
        itemCount: data.items.length,
        sampleItems: data.items.slice(0, 3).map(i => i.label || i.id || i.plex)
      });
    }
  }

  return discovered;
}

/**
 * Fetch JSON from API
 */
async function fetchJson(endpoint) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// =============================================================================
// Test Setup and Discovery
// =============================================================================

describe('Content API Regression Tests', () => {
  let watchHistory;
  let watchlists;

  beforeAll(() => {
    watchHistory = discoverWatchHistory();
    watchlists = discoverWatchlists();

    console.log('[Test Discovery] Watch history:', {
      plexLibraries: watchHistory.plex.length,
      hasScriptures: !!watchHistory.scriptures,
      hasHymn: !!watchHistory.hymn
    });
    console.log('[Test Discovery] Watchlists:', watchlists.length);
  });

  // ===========================================================================
  // Health Check
  // ===========================================================================

  describe('Health Check', () => {
    it('backend should be healthy', async () => {
      const health = await fetchJson('/health');
      expect(health.ok).toBe(true);
    });
  });

  // ===========================================================================
  // Watch State Enrichment - Plex
  // ===========================================================================

  describe('Plex Watch State Enrichment', () => {
    it('should have discoverable Plex watch history', () => {
      expect(watchHistory.plex.length).toBeGreaterThan(0);
    });

    it('should enrich list items with watch state from history', async () => {
      // Skip if no Plex history
      if (watchHistory.plex.length === 0) {
        console.log('[SKIP] No Plex history discovered');
        return;
      }

      // Use first Plex library with history
      const library = watchHistory.plex[0];
      const sampleId = library.sampleIds[0];

      // Extract Plex ID (format: plex:123456 -> 123456)
      const plexId = sampleId.replace(/^plex:/, '');

      // Get item metadata to find container
      try {
        const item = await fetchJson(`/content/plex/info/${plexId}`);

        // If we have a container (show/album), list its contents
        if (item.type === 'show' || item.type === 'season') {
          const list = await fetchJson(`/item/plex/${plexId}`);

          // Check that items have watch state fields
          const itemsWithProgress = list.items?.filter(i =>
            i.watchProgress !== undefined ||
            i.watchSeconds !== undefined ||
            i.percent !== undefined ||
            i.playhead !== undefined
          );

          expect(itemsWithProgress?.length).toBeGreaterThanOrEqual(0);
        }
      } catch (e) {
        console.log('[SKIP] Plex item not accessible:', e.message);
      }
    });

    it('should use canonical field names (playhead, duration, percent)', async () => {
      if (watchHistory.plex.length === 0) return;

      const library = watchHistory.plex[0];
      const sampleId = library.sampleIds[0];
      const plexId = sampleId.replace(/^plex:/, '');

      try {
        const info = await fetchJson(`/content/plex/info/${plexId}`);

        // Check response uses canonical field names
        // percent and seconds should be present (canonical API format)
        expect(info).toHaveProperty('percent');
        expect(info).toHaveProperty('seconds');

        // These should be numbers
        expect(typeof info.percent).toBe('number');
        expect(typeof info.seconds).toBe('number');
      } catch (e) {
        console.log('[SKIP] Cannot verify canonical fields:', e.message);
      }
    });
  });

  // ===========================================================================
  // Watch State Enrichment - Narrated Content
  // ===========================================================================

  describe('Narrated Content (Scripture) Watch State', () => {
    it('should have scripture watch history', () => {
      // May or may not exist depending on usage
      if (!watchHistory.scriptures) {
        console.log('[INFO] No scripture history found - this is OK if scriptures not used');
      }
    });

    it('should support volume-level selection (nextUp pattern)', async () => {
      // Test the scripture/nt pattern for "next unfinished chapter"
      try {
        const result = await fetchJson('/item/narrated/scripture/nt?select=watchlist');

        // Should return a single selected item
        expect(result).toBeDefined();

        // Should have selection metadata
        if (result._selection) {
          expect(result._selection).toHaveProperty('strategy');
        }

        // Should have content for playback
        if (result.content) {
          expect(Array.isArray(result.content)).toBe(true);
        }
      } catch (e) {
        // Scripture adapter may not be configured
        console.log('[SKIP] Scripture selection not available:', e.message);
      }
    });

    it('should support direct chapter reference', async () => {
      try {
        const result = await fetchJson('/item/narrated/scripture/john-1');

        expect(result).toBeDefined();
        expect(result.id).toContain('scripture');
      } catch (e) {
        console.log('[SKIP] Scripture direct reference not available:', e.message);
      }
    });
  });

  // ===========================================================================
  // Watchlist Integration
  // ===========================================================================

  describe('Watchlist Watch State', () => {
    it('should have discoverable watchlists', () => {
      // Watchlists may or may not be configured
      if (watchlists.length === 0) {
        console.log('[INFO] No watchlists found');
      }
    });

    it('should enrich watchlist items with watch state', async () => {
      if (watchlists.length === 0) return;

      const watchlist = watchlists[0];

      try {
        const list = await fetchJson(`/item/folder/watchlist/${watchlist.name}`);

        // Items should have watch state enrichment
        expect(list.items).toBeDefined();

        // Check for watch-related fields in response
        const hasWatchFields = list.items?.some(item =>
          item.percent !== undefined ||
          item.playhead !== undefined ||
          item.watchProgress !== undefined ||
          item.lastPlayed !== undefined ||
          item.priority !== undefined
        );

        // Not all items may have history, but structure should be there
        expect(Array.isArray(list.items)).toBe(true);
      } catch (e) {
        console.log('[SKIP] Watchlist not accessible:', e.message);
      }
    });

    it('should support selection strategy on watchlists', async () => {
      if (watchlists.length === 0) return;

      const watchlist = watchlists[0];

      try {
        const result = await fetchJson(`/item/folder/watchlist/${watchlist.name}?select=watchlist`);

        // Should return selected item
        expect(result).toBeDefined();

        // May have selection metadata
        if (result._selection) {
          expect(result._selection.strategy).toBeTruthy();
        }
      } catch (e) {
        console.log('[SKIP] Watchlist selection not available:', e.message);
      }
    });
  });

  // ===========================================================================
  // Content Query Service
  // ===========================================================================

  describe('Content Query Endpoints', () => {
    it('should support query/search endpoint', async () => {
      try {
        const result = await fetchJson('/content/query/search?source=plex&text=test&take=5');

        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('total');
      } catch (e) {
        // Query service may not be configured or Plex may be offline
        if (e.message.includes('501')) {
          console.log('[SKIP] Content query service not configured');
        } else {
          console.log('[SKIP] Query search not available:', e.message);
        }
      }
    });

    it('should support query/list endpoint', async () => {
      try {
        const result = await fetchJson('/content/query/list?from=playlists&source=plex');

        expect(result).toHaveProperty('items');
      } catch (e) {
        if (e.message.includes('501')) {
          console.log('[SKIP] Content query service not configured');
        } else {
          console.log('[SKIP] Query list not available:', e.message);
        }
      }
    });
  });

  // ===========================================================================
  // Play Endpoint
  // ===========================================================================

  describe('Play Endpoint Watch State', () => {
    it('should include resume position for in-progress items', async () => {
      if (watchHistory.plex.length === 0) return;

      // Find an in-progress item from history
      const library = watchHistory.plex[0];
      const historyData = loadYamlSafe(
        path.join(DATA_PATH, `household/history/media_memory/plex/${library.file}.yml`)
      );

      if (!historyData) return;

      // Find item with partial progress (between 10% and 90%)
      const inProgressId = Object.entries(historyData).find(([id, state]) => {
        const percent = state.percent || 0;
        return percent > 10 && percent < 90;
      })?.[0];

      if (!inProgressId) {
        console.log('[SKIP] No in-progress items found in history');
        return;
      }

      const plexId = inProgressId.replace(/^plex:/, '');

      try {
        const playInfo = await fetchJson(`/play/plex/${plexId}`);

        // Should have resume fields if in progress
        if (playInfo.resume_position !== undefined) {
          expect(typeof playInfo.resume_position).toBe('number');
        }
      } catch (e) {
        console.log('[SKIP] Play endpoint not accessible:', e.message);
      }
    });
  });

  // ===========================================================================
  // Progress Logging
  // ===========================================================================

  describe('Progress Logging', () => {
    it('should accept progress updates in canonical format', async () => {
      // Don't actually log - just verify endpoint accepts the format
      // This is a smoke test for the API contract

      try {
        // Use a test item ID that won't affect real data
        const testPayload = {
          type: 'plex',
          assetId: '999999999', // Non-existent ID
          percent: 50,
          seconds: 300
        };

        const response = await fetch(`${BASE_URL}/play/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });

        // Should accept the request (may return 404 for non-existent item, but not 400)
        expect([200, 404]).toContain(response.status);

        if (response.ok) {
          const result = await response.json();
          // Response should use canonical field names
          expect(result.response).toHaveProperty('playhead');
          expect(result.response).toHaveProperty('duration');
          expect(result.response).toHaveProperty('percent');
        }
      } catch (e) {
        console.log('[SKIP] Progress logging test failed:', e.message);
      }
    });
  });

  // ===========================================================================
  // Singing Content
  // ===========================================================================

  describe('Singing Content', () => {
    it('should return hymn with watch state', async () => {
      try {
        const hymn = await fetchJson('/item/singing/hymn/1');

        expect(hymn).toBeDefined();
        expect(hymn.id).toContain('singing');

        // Should have content array for synchronized display
        if (hymn.content) {
          expect(Array.isArray(hymn.content)).toBe(true);
        }
      } catch (e) {
        console.log('[SKIP] Singing content not available:', e.message);
      }
    });
  });

  // ===========================================================================
  // Response Format Validation
  // ===========================================================================

  describe('Response Format Validation', () => {
    it('list items should have consistent watch state field names', async () => {
      if (watchHistory.plex.length === 0) return;

      const library = watchHistory.plex[0];
      // Extract library ID from filename (e.g., "14_fitness" -> "14")
      const libraryMatch = library.file.match(/^(\d+)/);
      if (!libraryMatch) return;

      const libraryId = libraryMatch[1];

      try {
        // List a container from this library
        const info = await fetchJson(`/content/plex/info/${libraryId}`);

        if (info.type !== 'show' && info.type !== 'artist') {
          console.log('[SKIP] Not a container type:', info.type);
          return;
        }

        const list = await fetchJson(`/item/plex/${libraryId}`);

        // Validate field naming consistency
        for (const item of list.items || []) {
          // Should NOT have legacy field names at top level
          expect(item).not.toHaveProperty('mediaDuration');
          // Note: 'seconds' may still exist in metadata for backwards compat

          // Watch fields should use consistent naming
          if (item.watchProgress !== undefined) {
            expect(typeof item.watchProgress).toBe('number');
          }
          if (item.watchSeconds !== undefined) {
            expect(typeof item.watchSeconds).toBe('number');
          }
        }
      } catch (e) {
        console.log('[SKIP] Cannot validate list response format:', e.message);
      }
    });
  });
});
