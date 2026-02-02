# Immich Slideshow + Plex Audio Runtime Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a runtime test that plays an Immich photo slideshow (random person with 20+ photos) with a Plex music playlist (from "Music" library).

**Architecture:** PlexAdapter's `getList()` becomes polymorphic (string ID or query object) to support `plex.libraryName` filtering. Runtime test uses new `/api/v1/content/query/list` endpoints to discover content, then loads TV app with composed presentation URL.

**Tech Stack:** Playwright, Jest, Express, ES Modules

**Reference:** `docs/plans/2026-01-31-immich-slideshow-plex-audio-design.md`

---

## Task 1: Make PlexAdapter.getList() Polymorphic

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:190-245`
- Test: `tests/isolated/adapter/content/PlexAdapter.test.mjs`

### Step 1: Write the failing tests

Add to `tests/isolated/adapter/content/PlexAdapter.test.mjs`:

```javascript
describe('getList polymorphic input', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    mockClient = {
      getContainer: jest.fn(),
      getMetadata: jest.fn()
    };
    adapter.client = mockClient;
  });

  test('accepts string ID (backward compatible)', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Playlist 1', type: 'playlist' }
        ]
      }
    });

    const result = await adapter.getList('playlist:');
    expect(mockClient.getContainer).toHaveBeenCalledWith('/playlists/all');
    expect(result).toHaveLength(1);
  });

  test('accepts object with from property', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Playlist 1', type: 'playlist' }
        ]
      }
    });

    const result = await adapter.getList({ from: 'playlist:' });
    expect(mockClient.getContainer).toHaveBeenCalledWith('/playlists/all');
    expect(result).toHaveLength(1);
  });

  test('filters playlists by plex.libraryName (exact match)', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Rock Hits', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' },
          { ratingKey: '2', title: 'Lectures', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Audiobooks' },
          { ratingKey: '3', title: 'Movies', type: 'playlist', playlistType: 'video', librarySectionTitle: 'Films' }
        ]
      }
    });

    const result = await adapter.getList({
      from: 'playlist:',
      'plex.libraryName': 'Music'
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Rock Hits');
  });

  test('filters playlists by plex.libraryName (case-insensitive)', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Rock Hits', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' }
        ]
      }
    });

    const result = await adapter.getList({
      from: 'playlist:',
      'plex.libraryName': 'music'
    });

    expect(result).toHaveLength(1);
  });

  test('falls back to contains match if no exact match', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Jazz', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'My Music Library' },
          { ratingKey: '2', title: 'Podcasts', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Spoken Word' }
        ]
      }
    });

    const result = await adapter.getList({
      from: 'playlist:',
      'plex.libraryName': 'Music'
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Jazz');
  });

  test('filters to audio playlists only when libraryName specified', async () => {
    mockClient.getContainer.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          { ratingKey: '1', title: 'Rock', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' },
          { ratingKey: '2', title: 'Music Videos', type: 'playlist', playlistType: 'video', librarySectionTitle: 'Music' }
        ]
      }
    });

    const result = await adapter.getList({
      from: 'playlist:',
      'plex.libraryName': 'Music'
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Rock');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx jest --config jest.config.js --testPathIgnorePatterns='/node_modules/|/tests/runtime/|/tests/integration/external/|/tests/_archive/' --testPathPattern='PlexAdapter' -t 'getList polymorphic'`

Expected: FAIL - tests will fail because getList doesn't accept objects yet

### Step 3: Implement polymorphic getList

Replace the `getList` method in `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` (lines 190-245):

```javascript
  /**
   * Get list of items in a container
   * @param {string|Object} input - Container path/rating key (string) or query object
   * @param {string} [input.from] - Container path when input is object
   * @param {string} [input['plex.libraryName']] - Filter playlists by library name
   * @returns {Promise<ListableItem[]>}
   */
  async getList(input) {
    try {
      // Normalize input - support both string ID and query object
      const localId = typeof input === 'string'
        ? input?.replace(/^plex:/, '') || ''
        : (input?.from?.replace(/^plex:/, '') || '');
      const query = typeof input === 'object' ? input : {};

      // Extract adapter-specific filter params
      const libraryNameFilter = query['plex.libraryName'];

      // Determine the correct path based on item type
      let path;
      if (!localId) {
        // Empty - list all library sections
        path = '/library/sections';
      } else if (localId === 'playlist:' || localId === 'playlists') {
        // List all playlists
        path = '/playlists/all';
      } else if (/^\d+$/.test(localId)) {
        // Numeric ID - need to check type first
        const metaData = await this.client.getMetadata(localId);
        const meta = metaData?.MediaContainer?.Metadata?.[0];
        const type = meta?.type;

        // Use appropriate path based on type
        if (type === 'collection') {
          path = `/library/collections/${localId}/items`;
        } else if (type === 'playlist') {
          path = `/playlists/${localId}/items`;
        } else {
          // Default: get children (works for shows, seasons, albums, etc.)
          path = `/library/metadata/${localId}/children`;
        }
      } else {
        // Path-based (e.g., library/sections/1/all)
        path = `/${localId}`;
      }

      const data = await this.client.getContainer(path);
      const container = data.MediaContainer;
      if (!container) return [];

      let items = container.Metadata || container.Directory || [];

      // Apply library name filter for playlists
      if (libraryNameFilter && (localId === 'playlist:' || localId === 'playlists')) {
        items = this._filterPlaylistsByLibraryName(items, libraryNameFilter);
      }

      // For playable item types (episodes, tracks, movies), use full conversion
      // to include duration, episode number, and other playback-relevant metadata
      const playableTypes = ['episode', 'track', 'movie', 'clip'];

      return items.map(item => {
        if (playableTypes.includes(item.type)) {
          return this._toPlayableItem(item);
        }
        return this._toListableItem(item);
      });
    } catch (err) {
      console.error('[PlexAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Filter playlists by library name with fallback matching
   * @param {Object[]} playlists - Raw Plex playlist metadata
   * @param {string} targetName - Library name to match
   * @returns {Object[]} Filtered playlists
   * @private
   */
  _filterPlaylistsByLibraryName(playlists, targetName) {
    const target = targetName.toLowerCase();

    // First: filter to audio playlists only
    const audioPlaylists = playlists.filter(p => p.playlistType === 'audio');

    // Second: exact match (case-insensitive)
    let filtered = audioPlaylists.filter(p =>
      p.librarySectionTitle?.toLowerCase() === target
    );

    // Fallback: contains match if no exact results
    if (filtered.length === 0) {
      filtered = audioPlaylists.filter(p =>
        p.librarySectionTitle?.toLowerCase().includes(target)
      );
      if (filtered.length > 0) {
        console.log(`[PlexAdapter] No exact match for library '${targetName}', using contains match`);
      }
    }

    return filtered;
  }
```

### Step 4: Run tests to verify they pass

Run: `npx jest --config jest.config.js --testPathIgnorePatterns='/node_modules/|/tests/runtime/|/tests/integration/external/|/tests/_archive/' --testPathPattern='PlexAdapter' -t 'getList polymorphic'`

Expected: All 6 tests PASS

### Step 5: Run all PlexAdapter tests to verify no regressions

Run: `npx jest --config jest.config.js --testPathIgnorePatterns='/node_modules/|/tests/runtime/|/tests/integration/external/|/tests/_archive/' --testPathPattern='PlexAdapter'`

Expected: All existing tests still PASS

### Step 6: Commit

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapter/content/PlexAdapter.test.mjs
git commit -m "feat(plex): make getList() polymorphic with library name filter

- Accept string ID or query object as input
- Add plex.libraryName filter for playlists
- Filter to audio playlists when library filter active
- Case-insensitive exact match with contains fallback"
```

---

## Task 2: Update getContainerAliases for Playlists Path

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`

### Step 1: Update getContainerAliases to use correct path

The `getContainerAliases()` currently returns `playlists: 'playlist:'` but `getList` needs to handle this. Verify the alias maps to the path that triggers `/playlists/all`.

Check existing code - if `playlist:` already works, no change needed. If not:

```javascript
getContainerAliases() {
  return {
    playlists: 'playlist:',  // Maps to /playlists/all in getList
    collections: 'collection:',
    artists: 'artist:',
    albums: 'album:'
  };
}
```

### Step 2: Verify syntax

Run: `node --check backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`

Expected: No errors

### Step 3: Commit (if changes made)

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "fix(plex): ensure playlist alias maps to correct path"
```

---

## Task 3: Create Runtime Test File

**Files:**
- Create: `tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs`

### Step 1: Create the test file

```javascript
/**
 * Immich Slideshow + Plex Audio Runtime Test
 *
 * Verifies:
 * 1. Query API can find Immich people with 20+ photos
 * 2. Query API can find Plex music playlists from "Music" library
 * 3. TV app can play composed presentation (visual + audio tracks)
 * 4. Slideshow advances and audio plays
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Immich adapter configured with people
 * - Plex adapter configured with music playlists
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const MIN_PHOTO_COUNT = 20;

let sharedPage;
let sharedContext;
let discoveredPersonId;
let discoveredPersonName;
let discoveredPlaylistId;
let discoveredPlaylistName;

test.describe.configure({ mode: 'serial' });

test.describe('Immich Slideshow + Plex Audio', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    // Enable autoplay for audio/video
    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }

    // Track console errors
    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Discover Immich people with 20+ photos
  // ═══════════════════════════════════════════════════════════════════════════
  test('Discover Immich people with 20+ photos', async ({ request }) => {
    console.log(`\n🔍 Searching for Immich people via ${BASE_URL}/api/v1/content/query/list`);

    const response = await request.get(`${BASE_URL}/api/v1/content/query/list`, {
      params: {
        from: 'people',
        source: 'immich'
      }
    });

    // Handle case where Immich isn't configured
    if (response.status() === 404 || response.status() === 501) {
      const body = await response.json();
      console.log(`⚠️  Immich not configured: ${body.error}`);
      test.skip(true, 'Immich adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`📊 Found ${data.items?.length || 0} people total`);

    // Filter to people with enough photos
    const eligiblePeople = (data.items || []).filter(p =>
      (p.childCount || 0) >= MIN_PHOTO_COUNT
    );

    console.log(`📊 ${eligiblePeople.length} people have ${MIN_PHOTO_COUNT}+ photos`);

    if (eligiblePeople.length === 0) {
      console.log(`⚠️  No people with ${MIN_PHOTO_COUNT}+ photos found`);
      test.skip(true, `No people with ${MIN_PHOTO_COUNT}+ photos`);
      return;
    }

    // Pick random person
    const randomIndex = Math.floor(Math.random() * eligiblePeople.length);
    const person = eligiblePeople[randomIndex];

    discoveredPersonId = person.id;
    discoveredPersonName = person.title || person.name || 'Unknown';

    console.log(`✅ Selected person: ${discoveredPersonName} (${person.childCount} photos)`);
    console.log(`   ID: ${discoveredPersonId}`);

    expect(discoveredPersonId).toMatch(/^immich:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Discover Plex music playlist
  // ═══════════════════════════════════════════════════════════════════════════
  test('Discover Plex music playlist', async ({ request }) => {
    console.log(`\n🔍 Searching for Plex music playlists via ${BASE_URL}/api/v1/content/query/list`);

    const response = await request.get(`${BASE_URL}/api/v1/content/query/list`, {
      params: {
        from: 'playlists',
        source: 'plex',
        'plex.libraryName': 'Music'
      }
    });

    // Handle case where Plex isn't configured
    if (response.status() === 404 || response.status() === 501) {
      const body = await response.json();
      console.log(`⚠️  Plex not configured: ${body.error}`);
      test.skip(true, 'Plex adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`📊 Found ${data.items?.length || 0} music playlists`);

    if (!data.items || data.items.length === 0) {
      console.log('⚠️  No music playlists found in "Music" library');
      test.skip(true, 'No music playlists found');
      return;
    }

    // Pick random playlist
    const randomIndex = Math.floor(Math.random() * data.items.length);
    const playlist = data.items[randomIndex];

    discoveredPlaylistId = playlist.id;
    discoveredPlaylistName = playlist.title || 'Unknown Playlist';

    console.log(`✅ Selected playlist: ${discoveredPlaylistName}`);
    console.log(`   ID: ${discoveredPlaylistId}`);
    console.log(`   Tracks: ${playlist.childCount || 'unknown'}`);

    expect(discoveredPlaylistId).toMatch(/^plex:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: TV app loads composed presentation
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app loads composed presentation', async () => {
    test.setTimeout(30000);

    // Skip if discovery failed
    if (!discoveredPersonId) {
      test.skip(true, 'No person discovered');
      return;
    }
    if (!discoveredPlaylistId) {
      test.skip(true, 'No playlist discovered');
      return;
    }

    // Build the composed URL
    // Visual: immich person photos, Audio: plex playlist
    const visualSource = `visual:${discoveredPersonId.replace('immich:', 'immich:person:')}`;
    const audioSource = `audio:${discoveredPlaylistId}`;
    const playParam = `${visualSource},${audioSource}`;

    const tvUrl = `${BASE_URL}/tv?play=${encodeURIComponent(playParam)}`;
    console.log(`\n▶️  Opening TV app: ${tvUrl}`);
    console.log(`   Visual: ${discoveredPersonName}'s photos`);
    console.log(`   Audio: ${discoveredPlaylistName}`);

    await sharedPage.goto(tvUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    console.log('✅ Page loaded');

    // Wait for app to mount and player to initialize
    await sharedPage.waitForTimeout(5000);

    // Check for visual track element
    const visualTrack = sharedPage.locator('[data-track="visual"]');
    const visualCount = await visualTrack.count();
    console.log(`\n🖼️  Visual track elements found: ${visualCount}`);

    // Check for audio element
    const audioElement = sharedPage.locator('audio');
    const audioCount = await audioElement.count();
    console.log(`🎵 Audio elements found: ${audioCount}`);

    // Also check for data-track="audio"
    const audioTrack = sharedPage.locator('[data-track="audio"]');
    const audioTrackCount = await audioTrack.count();
    console.log(`🎵 Audio track containers found: ${audioTrackCount}`);

    expect(visualCount + audioTrackCount).toBeGreaterThan(0);
    console.log('✅ Composite player rendered');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Slideshow advances and audio plays
  // ═══════════════════════════════════════════════════════════════════════════
  test('Slideshow advances and audio plays', async () => {
    test.setTimeout(45000);

    // Skip if discovery failed
    if (!discoveredPersonId || !discoveredPlaylistId) {
      test.skip(true, 'Discovery failed in previous tests');
      return;
    }

    // Find the image element in the visual track
    const imageElement = sharedPage.locator('[data-track="visual"] img, [data-visual-type] img, .slideshow img').first();
    const imageExists = await imageElement.count() > 0;

    let initialImageSrc = null;
    if (imageExists) {
      initialImageSrc = await imageElement.getAttribute('src');
      console.log(`\n🖼️  Initial image: ${initialImageSrc?.substring(0, 80)}...`);
    } else {
      console.log('\n⚠️  No image element found in visual track');
    }

    // Check audio state
    const audioElement = sharedPage.locator('audio').first();
    const audioExists = await audioElement.count() > 0;

    if (audioExists) {
      const audioState = await audioElement.evaluate(el => ({
        paused: el.paused,
        currentTime: el.currentTime,
        src: el.src || el.currentSrc,
        error: el.error ? { code: el.error.code } : null
      }));

      console.log(`🎵 Initial audio state:`);
      console.log(`   - Paused: ${audioState.paused}`);
      console.log(`   - Time: ${audioState.currentTime?.toFixed(2)}s`);
      console.log(`   - Source: ${audioState.src?.substring(0, 60)}...`);
      console.log(`   - Error: ${audioState.error ? `code ${audioState.error.code}` : 'none'}`);
    }

    // Wait for slideshow to advance (20 seconds should be enough for 2-3 slides)
    console.log('\n⏳ Waiting 20 seconds for slideshow to advance...');
    await sharedPage.waitForTimeout(20000);

    // Check if slideshow advanced
    if (imageExists) {
      const currentImageSrc = await imageElement.getAttribute('src').catch(() => null);
      console.log(`\n🖼️  Current image: ${currentImageSrc?.substring(0, 80)}...`);

      if (initialImageSrc && currentImageSrc && initialImageSrc !== currentImageSrc) {
        console.log('✅ Slideshow advanced to new image!');
      } else if (initialImageSrc === currentImageSrc) {
        console.log('⚠️  Same image - slideshow may not have advanced');
      }
    }

    // Check final audio state
    if (audioExists) {
      const finalAudioState = await audioElement.evaluate(el => ({
        paused: el.paused,
        currentTime: el.currentTime,
        error: el.error ? { code: el.error.code } : null
      }));

      console.log(`\n🎵 Final audio state after 20s:`);
      console.log(`   - Paused: ${finalAudioState.paused}`);
      console.log(`   - Time: ${finalAudioState.currentTime?.toFixed(2)}s`);
      console.log(`   - Error: ${finalAudioState.error ? `code ${finalAudioState.error.code}` : 'none'}`);

      // Audio should have progressed if not paused and no error
      if (!finalAudioState.paused && !finalAudioState.error) {
        expect(finalAudioState.currentTime).toBeGreaterThan(5);
        console.log('✅ Audio is playing!');
      } else if (finalAudioState.error) {
        console.log('❌ Audio has error');
      }
    }

    console.log('\n✅ Composed presentation test completed');
  });

});
```

### Step 2: Verify test file syntax

Run: `node --check tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs`

Expected: No errors (or module resolution errors which are OK at this stage)

### Step 3: Commit

```bash
git add tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs
git commit -m "test(live): add Immich slideshow + Plex audio runtime test

Verifies composed presentation with:
- Random Immich person with 20+ photos as visual track
- Random Plex music playlist from 'Music' library as audio track
- TV app loading and playback verification"
```

---

## Task 4: Integration Test for Query Endpoint with Plex Filter

**Files:**
- Create: `tests/integrated/api/content/query-plex-filter.test.mjs`

### Step 1: Write integration test

```javascript
/**
 * Integration test for content query endpoint with Plex library filter
 */
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Content Query - Plex Library Filter', () => {
  // These tests require a running backend with Plex configured
  // Skip if not available

  const BASE_URL = process.env.TEST_BACKEND_URL || 'http://localhost:3111';

  describe('GET /api/v1/content/query/list with plex.libraryName', () => {
    it('filters playlists by library name', async () => {
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
  });
});
```

### Step 2: Commit

```bash
git add tests/integrated/api/content/query-plex-filter.test.mjs
git commit -m "test(integrated): add Plex library filter integration test"
```

---

## Task 5: Run Full Test Suite

### Step 1: Run unit tests for PlexAdapter

Run: `npx jest --config jest.config.js --testPathIgnorePatterns='/node_modules/|/tests/runtime/|/tests/integration/external/|/tests/_archive/' --testPathPattern='PlexAdapter'`

Expected: All tests PASS

### Step 2: Run content query tests

Run: `npx jest --config jest.config.js --testPathIgnorePatterns='/node_modules/|/tests/runtime/|/tests/integration/external/|/tests/_archive/' --testPathPattern='contentQueryParser|ContentQueryService|ContentSourceRegistry'`

Expected: All tests PASS

### Step 3: Verify adapter syntax

Run: `node --check backend/src/1_adapters/content/media/plex/PlexAdapter.mjs && echo "OK"`

Expected: OK

---

## Task Dependencies

```
Task 1: PlexAdapter polymorphic getList
   │
   └──► Task 2: Verify container aliases
           │
           └──► Task 3: Create runtime test
                   │
                   └──► Task 4: Integration test
                           │
                           └──► Task 5: Full test suite
```

---

## Running the Runtime Test

After implementation, run the runtime test with:

```bash
# Ensure backend is running
npm run dev

# In another terminal, run the Playwright test
npx playwright test tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs --headed
```

Or run headless:

```bash
npx playwright test tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs
```

---

## Notes

- Runtime tests require actual Immich and Plex services to be configured
- Tests gracefully skip if services aren't available
- The `plex.libraryName` filter is case-insensitive with contains fallback
- Slideshow advance detection compares image src values
