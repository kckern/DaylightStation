# Audio Content Feed — Design

**Date:** 2026-02-17
**Status:** Approved

## Overview

Replace the `plex-music` query (single Plex parent, compass tier) with a new `audio-content` query that serves educational audiobooks from multiple Plex artists with weighted selection. Items appear in the **library** tier and are fully **playable** in the feed with an overhauled frontend playable-content experience.

## Target Content (Plex Artist IDs)

| ID     | Name           | Weight | Notes                          |
|--------|----------------|--------|--------------------------------|
| 7578   | Hourly History | 3      | Short educational history programs |
| 481800 | Scribd Coach   | 2      | Coaching/self-improvement      |
| 242600 | DK Business    | 1      | Business audiobook             |

Each "album" under these artists is a single track about a specific educational topic.

## Architecture

### Data Flow

```
audio-content.yml (query config)
  → FeedPoolManager picks query
  → PlexFeedAdapter.fetchItems()
    → weighted random selects a parentId
    → plexAdapter.getList(parentId) fetches albums
    → filters unwatched, randomizes, picks 1
    → maps to FeedItem with meta.playable + meta.duration
  → FeedAssemblyService returns to frontend
  → FeedCard renders with play overlay + duration badge
  → User taps Play → PersistentPlayer plays plex:{ratingKey}
  → FeedPlayerMiniBar shows with seekable progress
```

### Query Config

**File:** `data/users/kckern/config/queries/audio-content.yml`

```yaml
type: plex
tier: library
priority: 5
limit: 1
params:
  mode: children
  parentIds:
    - id: 7578
      weight: 3
    - id: 481800
      weight: 2
    - id: 242600
      weight: 1
  unwatched: true
```

**Feed config change** (`data/users/kckern/config/feed.yml`):
- Remove `plex-music` from `scroll.tiers.compass.sources`
- Add `audio-content` to `scroll.tiers.library.sources` with `max_per_batch: 1`, `padding: true`

## Backend Changes

### PlexFeedAdapter.mjs

**New: `parentIds` array support in `#fetchChildren()`**

When `query.params.parentIds` is present (array of `{ id, weight }`):
1. Weighted random selection: sum weights, pick random threshold, iterate to select parentId
2. Call `plexAdapter.getList(selectedParentId)` for that artist's albums
3. Filter unwatched (if `query.params.unwatched`)
4. Shuffle and pick `query.limit` items
5. Map to FeedItem shape with enriched metadata:
   - `meta.playable: true`
   - `meta.duration` — track duration in seconds (from Plex `item.metadata.duration`, converted from ms)
   - `meta.artistName` — parent series name (from Plex metadata)
   - `meta.sourceName` — "Audio" or the artist name

Falls back to existing single `parentId` behavior when `parentIds` is absent. Zero breaking changes.

### Metadata Mapping

```
Plex album item → FeedItem:
  id:        plex:{ratingKey}
  tier:      library
  source:    plex
  title:     album title (episode name)
  body:      artist name (series)
  image:     /api/v1/proxy/plex/photo/:/transcode?url={thumb}
  link:      plex web link
  timestamp: addedAt
  meta:
    playable:    true
    duration:    seconds (number)
    artistName:  series/artist name
    sourceName:  artist name
    type:        album type
```

## Frontend Changes

### 1. FeedCard.jsx — Generic Playable Flag

**Before (line 93):**
```jsx
{(item.source === 'plex' || item.meta?.youtubeId) && (
```

**After:**
```jsx
{item.meta?.playable && (
```

Also add a duration badge overlay on the hero image when `meta.duration` exists:
```jsx
{item.meta?.duration && (
  <span className="feed-card-duration">{formatDuration(item.meta.duration)}</span>
)}
```

Positioned bottom-right of the hero image, styled like YouTube duration badges.

### 2. MediaBody.jsx — Audio Indicator

Add an audio/speaker icon when the item is playable audio (not video):
- Small speaker icon next to the source label badge
- Duration text in the subtitle area when available

### 3. FeedPlayerMiniBar.jsx — Enhanced Controls

Current state: play/pause toggle, title, non-interactive progress bar.

Enhanced:
- **Time display**: "12:30 / 45:00" next to play/pause
- **Seekable progress bar**: onClick handler to seek (same pattern as PlayerSection)
- **Source name**: Show `meta.sourceName` or `meta.artistName`

## Files Changed

| # | File | Action |
|---|------|--------|
| 1 | `data/users/kckern/config/queries/audio-content.yml` | Create |
| 2 | `data/users/kckern/config/queries/plex-music.yml` | Delete |
| 3 | `data/users/kckern/config/feed.yml` | Modify: move source between tiers |
| 4 | `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs` | Modify: add parentIds + playable meta |
| 5 | `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx` | Modify: generic playable flag + duration badge |
| 6 | `frontend/src/modules/Feed/Scroll/cards/bodies/MediaBody.jsx` | Modify: audio indicator |
| 7 | `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx` | Modify: time display + seekable progress |

## Non-Goals

- No new adapter class (reuses PlexFeedAdapter)
- No new body component (reuses MediaBody)
- No ABS integration (these are Plex items)
- No changes to PersistentPlayer or Player (content ID format unchanged)
