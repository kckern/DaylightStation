# Content Search API + Immich Playback Test

## Overview

Add a multi-source content search API endpoint and a live flow test that dynamically discovers an Immich video and verifies playback via TV app.

## Context

- **IMediaSearchable** interface already exists in domain layer
- **ImmichAdapter** already implements `search()` and `getSearchCapabilities()`
- Need HTTP endpoint to expose search capability
- Live test should not hardcode asset IDs - discover dynamically

## API Design

### Endpoint

`GET /api/v1/content/search`

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `sources` | string | Comma-separated source filter (optional, defaults to all searchable) |
| `text` | string | Free text search |
| `people` | string | Comma-separated person names |
| `dateFrom` | string | ISO date start |
| `dateTo` | string | ISO date end |
| `location` | string | City/state/country |
| `mediaType` | string | `image`, `video`, or `audio` |
| `favorites` | boolean | Only favorites |
| `take` | number | Limit results |
| `skip` | number | Offset for pagination |
| `sort` | string | `date`, `title`, or `random` |

### Response

```json
{
  "query": { "mediaType": "video", "take": 10 },
  "sources": ["immich"],
  "total": 42,
  "items": [
    { "id": "immich:abc-123", "source": "immich", "title": "Beach Video.mp4", ... }
  ]
}
```

## File Structure

### New/Modified Files

```
backend/src/4_api/v1/routers/content.mjs  # Add search endpoint
tests/live/flow/content/immich-video-playback.runtime.test.mjs  # New test
```

## Implementation Plan

### Task 1: Add Search Endpoint to Content Router

**File:** `backend/src/4_api/v1/routers/content.mjs`

Add endpoint that:
1. Parses query params into MediaSearchQuery
2. Filters registry for adapters implementing IMediaSearchable
3. Calls search() on each, merges results
4. Returns combined results with source attribution

### Task 2: Create Live Flow Test

**File:** `tests/live/flow/content/immich-video-playback.runtime.test.mjs`

Test that:
1. Calls search API to find a video
2. Skips gracefully if no videos found
3. Opens TV app with `?play=immich:{id}`
4. Verifies video element plays
