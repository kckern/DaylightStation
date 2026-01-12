# Content API Migration Guide

This document guides frontend developers through migrating from legacy endpoints to the new Content Domain API.

## Migration Priority

| Priority | Legacy Endpoint | New Endpoint | Impact |
|----------|-----------------|--------------|--------|
| **CRITICAL** | `/media/plex/info/:id` | `/api/play/plex/:id` | All playback |
| **CRITICAL** | `/media/info/*` | `/api/play/filesystem/*` | All playback |
| **CRITICAL** | `/media/log` | `/api/content/progress/:source/*` | Watch tracking |
| **HIGH** | `/data/list/:folder` | `/api/list/folder/:name` | Menu navigation |
| **HIGH** | `/media/plex/list/:id` | `/api/list/plex/:id` | Plex browsing |
| **MEDIUM** | `/data/scripture/*` | `/api/local-content/scripture/*` | Scripture |
| **MEDIUM** | `/data/talk/*` | `/api/local-content/talk/*` | Talks |
| **MEDIUM** | `/data/hymn/:num` | `/api/local-content/hymn/:num` | Hymns |
| **MEDIUM** | `/data/poetry/*` | `/api/local-content/poem/*` | Poetry |
| **LOW** | `/media/plex/img/:id` | `/proxy/plex/thumb/:id` | Thumbnails |

## File-by-File Migration

### Player Module

**File:** `frontend/src/modules/Player/lib/api.js`

| Old | New |
|-----|-----|
| `DaylightAPI(\`media/plex/info/${plex}/shuffle\`)` | `DaylightAPI(\`api/play/plex/${plex}/shuffle\`)` |
| `DaylightAPI(\`media/info/${media}?shuffle=...\`)` | `DaylightAPI(\`api/play/filesystem/${media}?shuffle=...\`)` |

**Response mapping:**
```javascript
// Old response shape
{ media_key, media_url, media_type, title, duration, plex, show, season, episode }

// New response shape (same fields, just different endpoint)
{ id, media_key, media_url, media_type, title, duration, plex, show, season, episode }
```

### Menu Module

**File:** `frontend/src/modules/Menu/Menu.jsx`

| Old | New |
|-----|-----|
| `DaylightAPI(\`data/list/${target}/${config}\`)` | `DaylightAPI(\`api/list/folder/${target}/${config}\`)` |

**Note:** Replace `+` with `%20` in folder names:
- Old: `data/list/Morning+Program`
- New: `api/list/folder/Morning%20Program`

### ContentScroller Module

**File:** `frontend/src/modules/ContentScroller/ContentScroller.jsx`

| Old | New |
|-----|-----|
| `DaylightAPI(\`data/scripture/${ref}\`)` | `DaylightAPI(\`api/local-content/scripture/${ref}\`)` |
| `DaylightAPI(\`data/talk/${id}\`)` | `DaylightAPI(\`api/local-content/talk/${id}\`)` |
| `DaylightAPI(\`data/hymn/${num}\`)` | `DaylightAPI(\`api/local-content/hymn/${num}\`)` |
| `DaylightAPI(\`data/poetry/${id}\`)` | `DaylightAPI(\`api/local-content/poem/${id}\`)` |

### Progress Logging

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

| Old | New |
|-----|-----|
| `DaylightAPI('media/log', payload)` | `DaylightAPI('api/content/progress/${source}/${id}', payload)` |

**Payload change:**
```javascript
// Old payload
{ title, type, media_key, seconds, percent, watched_duration }

// New payload
{ seconds, duration }
// (source and id are in the URL now)
```

## Testing Your Migration

After updating an endpoint:

1. **Verify response shape** - Check that all fields your code uses are present
2. **Test with shim disabled** - Temporarily comment out legacy shim to ensure new endpoint works
3. **Check console for deprecation warnings** - If you still see warnings, something is still using legacy

## Deprecation Headers

All legacy endpoints now return deprecation headers:

```
X-Deprecated: Use /api/play/plex/12345 instead
X-Deprecated-Since: 2026-01-10
```

Check your network requests for these headers to identify any endpoints you may have missed.

## Timeline

| Date | Milestone |
|------|-----------|
| 2026-01-10 | New endpoints available, shims active |
| 2026-02-01 | Deprecation warnings in console |
| 2026-03-01 | Legacy endpoints removed |

## Getting Help

If you encounter issues during migration:
1. Check the response shape matches what you expect
2. Look for `X-Deprecated` headers indicating which new endpoint to use
3. Review the API Consumer Inventory in `docs/_wip/plans/2026-01-10-api-consumer-inventory.md`
