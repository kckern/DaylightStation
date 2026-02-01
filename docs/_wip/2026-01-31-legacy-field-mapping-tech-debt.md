# Legacy Field Mapping Technical Debt

**Date:** 2026-01-31
**Status:** Active tech debt

## Overview

The frontend `AudioPlayer` component uses legacy field names that don't match the new DDD domain model. We've added aliases in `toJSON()` and adapter metadata to maintain backwards compatibility, but this creates duplication and should be cleaned up.

## Current Legacy Mappings

### PlayableItem.toJSON() (backend/src/2_domains/content/capabilities/Playable.mjs)

| Legacy Field | DDD Field | Used By |
|--------------|-----------|---------|
| `media_url` | `mediaUrl` | AudioPlayer, VideoPlayer |
| `media_type` | `mediaType` | SinglePlayer routing |
| `media_key` | `id` | Progress tracking, logging |
| `image` | `thumbnail` | AudioPlayer cover art |
| `seconds` | `resumePosition` | AudioPlayer resume |

### AudiobookshelfAdapter metadata

| Legacy Field | Source | Used By |
|--------------|--------|---------|
| `metadata.artist` | `metadata.author` | AudioPlayer artist display |
| `metadata.albumArtist` | `metadata.narrator` | AudioPlayer narrator display |
| `metadata.album` | `metadata.seriesName` | AudioPlayer series display |

### Plex Adapter (already had legacy support)

The Plex adapter has extensive legacy field mappings in `/api/v1/content/plex/info/:id` endpoint that normalize to legacy format.

## Frontend Components Requiring Updates

### AudioPlayer.jsx

```javascript
// Current - uses legacy names:
const { media_url, title, artist, albumArtist, album, image, type } = media || {};
const effectiveArtist = artist || media?.metadata?.artist || ...
const effectiveAlbum = album || media?.metadata?.album || ...

// Should become:
const { mediaUrl, title, thumbnail, metadata } = media || {};
const artist = metadata?.artist || metadata?.author || ...
```

### VideoPlayer.jsx

Uses `media_url` - should use `mediaUrl`.

### SinglePlayer.jsx

```javascript
// Current - checks media_type
const isPlayable = info.media_url || ['dash_video', 'video', 'audio'].includes(info.media_type);

// Should use:
const isPlayable = info.mediaUrl || ['dash_video', 'video', 'audio'].includes(info.mediaType);
```

### Player/lib/api.js

The `fetchMediaInfo` function returns whatever the backend sends. No changes needed there.

## Recommended Migration Plan

1. **Phase 1: Dual Support (Current)**
   - Backend sends both legacy and DDD field names via toJSON()
   - Frontend continues using legacy names
   - No breaking changes

2. **Phase 2: Update Frontend Components**
   - Update AudioPlayer to use DDD names with fallback to legacy
   - Update VideoPlayer similarly
   - Update SinglePlayer type checks

3. **Phase 3: Remove Legacy Aliases**
   - Remove legacy aliases from PlayableItem.toJSON()
   - Remove metadata aliases from adapters
   - Update content router if needed

## Files to Update (Phase 2)

- [ ] `frontend/src/modules/Player/components/AudioPlayer.jsx`
- [ ] `frontend/src/modules/Player/components/VideoPlayer.jsx`
- [ ] `frontend/src/modules/Player/components/SinglePlayer.jsx`
- [ ] `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- [ ] `frontend/src/modules/Player/utils/mediaIdentity.js`

## Files to Update (Phase 3)

- [ ] `backend/src/2_domains/content/capabilities/Playable.mjs` - Remove toJSON aliases
- [ ] `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs` - Remove metadata aliases
- [ ] Any other adapters with legacy mappings

## Testing Checklist

When migrating, verify:
- [ ] Plex video playback still works
- [ ] Plex audio (music) playback still works
- [ ] Audiobookshelf audiobook playback shows cover art and metadata
- [ ] Immich video playback works
- [ ] Progress tracking works for all sources
- [ ] Resume position is restored correctly
