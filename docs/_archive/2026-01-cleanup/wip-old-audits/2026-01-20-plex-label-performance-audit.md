# Plex Label Performance Audit - 2026-01-20

## Summary

During the backend sync porting work, code review identified performance and maintainability issues in the Plex label handling code. These issues exist in both `backend/_legacy/lib/plex.mjs` (main branch) and were initially ported to `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` (backend-refactor branch).

## Issues Identified

### 1. N+1 Query Problem (Performance - Important)

**Location:** `buildPlayableObject()` in _legacy, `getItem()` in src/

**Problem:** When fetching episode metadata, the code now makes an additional API call to fetch the parent show's labels. When resolving a queue of episodes (e.g., a season with 20 episodes), this results in:

- **Before:** 20 API calls (1 per episode)
- **After:** 40 API calls (1 episode + 1 show per episode)

For episodes from the same show, the show metadata is fetched redundantly for every episode.

**Impact:**
- Loading a TV show queue is ~2x slower
- Increased load on Plex server
- Increased latency for fitness app episode selection

**Code pattern:**
```javascript
// In buildPlayableObject (called per episode):
if (type === 'episode' && itemData.grandparentRatingKey) {
  const [showData] = await this.loadMeta(itemData.grandparentRatingKey);
  // ... extract labels
}
```

### 2. DRY Violation (Maintainability - Important)

**Location:** Label extraction logic appears in 3 places

**Problem:** The same label extraction pattern is duplicated:

```javascript
// Pattern repeated 3 times:
const labels = [];
if (item.Label && Array.isArray(item.Label)) {
  for (const label of item.Label) {
    if (typeof label === 'string') labels.push(label.toLowerCase());
    else if (label?.tag) labels.push(label.tag.toLowerCase());
  }
}
```

**Locations in _legacy (`lib/plex.mjs`):**
- `buildPlayableObject()` - show labels extraction
- `buildPlayableObject()` - item labels extraction
- `getContainerMetadata()` - container labels

**Impact:**
- Bug fixes must be applied in 3 places
- Risk of inconsistent behavior
- Harder to maintain

## Recommended Fixes

### Fix 1: Cache Show Labels During Batch Operations

```javascript
// In queue/playlist resolution:
const showLabelCache = new Map();

async function getShowLabels(showKey) {
  if (showLabelCache.has(showKey)) {
    return showLabelCache.get(showKey);
  }
  const labels = await fetchShowLabels(showKey);
  showLabelCache.set(showKey, labels);
  return labels;
}
```

### Fix 2: Extract Label Helper

```javascript
_extractLabels(labelArray) {
  if (!Array.isArray(labelArray)) return [];
  return labelArray.map(label =>
    typeof label === 'string' ? label.toLowerCase() : label?.tag?.toLowerCase()
  ).filter(Boolean);
}
```

## Status

| Branch | Status |
|--------|--------|
| `main` (_legacy) | **Issues present** - not yet fixed |
| `backend-refactor` (src/) | **Fixed** in commit `fix(plex): extract label helper and cache show labels for batch ops` |

## Recommendation

The fixes applied to `backend-refactor` should be backported to `main` branch's `_legacy/lib/plex.mjs` if:
1. Fitness app frequently loads episode queues
2. Users report slow queue loading
3. Plex server logs show excessive metadata requests

## Related Code

- `backend/_legacy/lib/plex.mjs` - Legacy Plex client (main branch)
- `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` - Refactored adapter (backend-refactor)
- `frontend/src/modules/Fitness/` - Fitness app that uses Plex for video playback
