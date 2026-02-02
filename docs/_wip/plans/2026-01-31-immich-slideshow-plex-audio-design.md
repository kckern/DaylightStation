# Immich Slideshow + Plex Audio Runtime Test Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan after design approval.

**Goal:** Runtime test verifying the TV app can play a composed presentation with Immich photo slideshow and Plex music playlist.

**Date:** 2026-01-31

---

## Overview

Create a Playwright runtime test that:
1. Discovers a random Immich person with 20+ photos
2. Discovers a random Plex music playlist from "Music" library
3. Loads the TV app with both tracks composed
4. Verifies slideshow advances and audio plays

---

## Visual Track: Immich Person Photos

**Selection criteria:**
- Source: Immich gallery
- Container: People (`from=people`)
- Filter: `childCount >= 20` (minimum 20 photos)
- Selection: Random from filtered list

**Query:**
```
GET /api/v1/content/query/list?from=people&source=immich
```

**Post-filter in test:** `items.filter(p => p.childCount >= 20)`

---

## Audio Track: Plex Music Playlist

**Selection criteria:**
- Source: Plex media
- Container: Playlists (`from=playlists`)
- Filter: `playlistType === 'audio'`
- Filter: Library name matches "Music" (case-insensitive)
- Selection: Random from filtered list

**Query:**
```
GET /api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=Music
```

**Library name matching:**
1. First pass: exact match (case-insensitive)
2. Fallback: contains match if no exact results

---

## PlexAdapter Changes

### Polymorphic `getList(input)`

Change signature from `getList(id)` to `getList(input)` where input can be:
- **String:** Treated as container ID (backward compatible)
- **Object:** Treated as query with `from`, adapter-specific params

```javascript
async getList(input) {
  // Normalize input
  const localId = typeof input === 'string'
    ? input?.replace(/^plex:/, '')
    : input?.from?.replace(/^plex:/, '') || '';
  const query = typeof input === 'object' ? input : {};

  // Extract adapter-specific params
  const libraryNameFilter = query['plex.libraryName'];

  // ... existing logic ...

  // Apply filters for playlists
  if (localId === 'playlist:' && libraryNameFilter) {
    items = filterByLibraryName(items, libraryNameFilter);
  }
}
```

### Library Name Filter Logic

```javascript
function filterByLibraryName(playlists, targetName) {
  const target = targetName.toLowerCase();

  // First pass: exact match (case-insensitive)
  let filtered = playlists.filter(p =>
    p.metadata?.librarySectionTitle?.toLowerCase() === target
  );

  // Fallback: contains match
  if (filtered.length === 0) {
    filtered = playlists.filter(p =>
      p.metadata?.librarySectionTitle?.toLowerCase().includes(target)
    );
  }

  return filtered;
}
```

---

## Test Structure

**File:** `tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs`

### Test 1: Discover Immich People

```javascript
test('Discover Immich people with 20+ photos', async ({ request }) => {
  // GET /api/v1/content/query/list?from=people&source=immich
  // Filter to childCount >= 20
  // Pick random, store discoveredPersonId
});
```

### Test 2: Discover Plex Music Playlist

```javascript
test('Discover Plex music playlist', async ({ request }) => {
  // GET /api/v1/content/query/list?from=playlists&source=plex&plex.libraryName=Music
  // Filter to playlistType === 'audio'
  // Pick random, store discoveredPlaylistId
});
```

### Test 3: TV App Loads Composed Presentation

```javascript
test('TV app loads composed presentation', async () => {
  // Navigate to /tv?play=visual:immich:person:{id},audio:plex:{playlistId}
  // Verify [data-track="visual"] exists
  // Verify audio element exists
});
```

### Test 4: Playback Verification

```javascript
test('Slideshow advances and audio plays', async () => {
  // Record initial image src
  // Wait 15-20 seconds
  // Verify image src changed (slideshow advanced)
  // Verify audio.currentTime > 0
});
```

---

## Error Handling

### Graceful Skips

| Condition | Action |
|-----------|--------|
| Immich not configured | `test.skip('Immich adapter not configured')` |
| No people with 20+ photos | `test.skip('No people with sufficient photos found')` |
| Plex not configured | `test.skip('Plex adapter not configured')` |
| No music playlists | `test.skip('No music playlists found in Music library')` |

### Actual Failures

- API returns 500 error → test fails
- TV app JavaScript error → test fails
- Slideshow doesn't advance after 20s → test fails
- Audio element has error state → test fails

---

## Logging

```
🔍 Searching for Immich people...
📊 Found 12 people, 5 with 20+ photos
✅ Selected person: Alice (47 photos)

🔍 Searching for Plex music playlists...
📊 Found 8 audio playlists in "Music" library
✅ Selected playlist: Chill Vibes (23 tracks)

▶️ Loading TV app: /tv?play=visual:immich:person:abc123,audio:plex:456
✅ Composite player loaded
🖼️ Initial image: photo1.jpg
🎵 Audio playing: 0.0s

⏳ Waiting 20 seconds...

🖼️ Current image: photo3.jpg (advanced!)
🎵 Audio position: 18.5s
✅ Composed presentation playing successfully
```

---

## Files to Create/Modify

1. **Modify:** `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
   - Make `getList()` polymorphic
   - Add `plex.libraryName` filter support

2. **Create:** `tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs`
   - 4 serial tests following existing pattern

---

## Test Timeout

- **Total:** 60 seconds
- **Discovery phase:** ~5 seconds
- **Page load:** ~5 seconds
- **Playback verification:** 20 seconds
- **Buffer:** 30 seconds
