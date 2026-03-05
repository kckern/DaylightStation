# Video Segments Design

## Overview

Add video segmentation to the query/player system. When a video exceeds a duration threshold, it is automatically split into multiple clips distributed evenly throughout the source file. Each segment behaves as an independent video in the queue — isolated playback, progress bar, seeking, and advancement.

## Query YAML Config

New `videoRules` key at the item level (sibling to `params`, `slideshow`):

```yaml
items:
  - type: immich
    sort: day_desc_time_asc
    params:
      month: 3
      day: 4
      yearFrom: 2021
    videoRules:
      maxDuration: 60        # segment videos longer than this (seconds)
      segmentCount: 3         # number of clips to extract
      segmentLength: 15       # each clip's duration (seconds)
    slideshow:
      duration: 5
      effect: kenburns
```

- `videoRules` only applies to items with `mediaType === 'video'`
- Images pass through unchanged
- Grace margin: videos within 10% of `maxDuration` play unsegmented (e.g., threshold 60s → videos up to 66s play as-is)

## Queue Item Shape

Each segment becomes a distinct queue item:

```json
{
  "id": "immich:abc123#seg0",
  "mediaUrl": "/api/v1/proxy/immich/assets/abc123/original",
  "duration": 15,
  "segment": { "start": 0, "end": 15, "index": 0, "total": 3 },
  "metadata": { "capturedAt": "2024-03-04T14:30:00Z" }
}
```

- `id` uses `#segN` suffix — unique per segment, same source media
- `duration` reflects the segment length, not the source video
- `segment` object carries start/end times and position info
- `mediaUrl` is identical across all segments of the same source

## Segment Distribution

Videos are divided into `segmentCount` equal zones. Each segment starts at the beginning of its zone.

**Example:** 300s video, 3 segments of 15s each:
- Zone size: `300 / 3 = 100s`
- Seg 0: `{ start: 0, end: 15 }`
- Seg 1: `{ start: 100, end: 115 }`
- Seg 2: `{ start: 200, end: 215 }`

## Backend — Segment Expansion

In `QueryAdapter.#resolveImmichQuery()`, after sorting and before return:

1. Check if `videoRules` exists on the query
2. For each video item where `duration > maxDuration * 1.1`:
   - Calculate `zoneDuration = duration / segmentCount`
   - For each zone `i` (0 to segmentCount-1):
     - `start = i * zoneDuration`
     - `end = start + segmentLength`
   - Replace the original item with `segmentCount` new items
   - Each new item gets `segment` object and `#segN` ID suffix
3. Videos under threshold pass through unchanged
4. Segments of the same video stay consecutive and in order

## Player — Segment-Aware Playback

Segments behave as if clipped into their own video file. The user should have no awareness they're watching a segment.

### On Load
- If `media.segment` exists, seek to `segment.start` on `canplay`
- Suppress resume position — segments always start at their defined start

### Progress Tracking
- `displayedDuration = segment.end - segment.start`
- `displayedProgress = currentTime - segment.start`
- Progress bar: `(displayedProgress / displayedDuration) * 100`

### Seeking
- Clicking progress bar maps to segment range: `targetTime = segment.start + (clickPercent * displayedDuration)`

### End Detection
- `timeupdate` handler checks `currentTime >= segment.end` and triggers `advance()`
- The `<video>` element's native `ended` event won't fire since the file continues past the segment

### Time Display
- `formatTime()` shows time relative to segment: 0:00 to 0:15, not absolute timestamps

### Everything Else
- Stall recovery, bitrate adaptation, quality monitoring, keyboard controls unchanged — they operate on the media element directly

## Implementation Scope

### Backend (QueryAdapter.mjs)
- Expand video items into segments after sorting
- Stamp `segment` object on each expanded item
- Append `#segN` to item IDs

### Backend (queue.mjs)
- Pass `segment` through in `toQueueItem()`

### Frontend (VideoPlayer.jsx / useCommonMediaController)
- Seek to `segment.start` on load
- Virtual progress: display segment-relative time/duration
- End detection: advance on `segment.end`
- Seek clamping: map progress bar clicks to segment range

### Frontend (ProgressBar.jsx)
- No changes needed — already receives percent from parent

### Frontend (helpers.js)
- `formatTime` / `getProgressPercent` may need segment-aware variants or the caller adjusts inputs
