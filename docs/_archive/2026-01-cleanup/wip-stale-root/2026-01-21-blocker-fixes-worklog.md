# Blocker Fixes Work Log

**Date:** 2026-01-21
**Goal:** Fix 4 blockers identified in parity audit to enable frontend API migration

---

## Blockers to Fix

| # | Blocker | Root Cause | Status |
|---|---------|------------|--------|
| 1 | `POST /media/log` fails | Permission denied: `/data/media_memory` | **FIXED** |
| 2 | `/data/list/*` returns 404 | Missing `local` content source adapter | **RESOLVED** (path mapping) |
| 3 | `/data/scripture/*` returns 404 | LocalContent adapter data path issue | **FIXED** |
| 4 | `/api/fitness/zone_led` fails | Home Assistant not configured | **FIXED** |

---

## Work Log

### 11:15 - Starting investigation

Beginning systematic investigation of each blocker.

---

### Blocker 1: `/media/log` Permission Error

**11:20 - Root Cause Found**

The error was:
```
EACCES: permission denied, mkdir '/data/media_memory'
```

Investigation:
1. Docker mounts data at `/usr/src/app/data` (inside container)
2. New backend was using `/data/media_memory` as absolute path
3. This path doesn't exist and container can't create it

**Fix Applied** (`backend/src/app.mjs:235`):
```javascript
// Before:
const watchStatePath = process.env.path?.watchState || '/data/media_memory';

// After:
const watchStatePath = process.env.path?.watchState || `${dataBasePath}/history/media_memory`;
```

This now correctly uses the data path (e.g., `/usr/src/app/data/history/media_memory`) which matches the legacy structure.

---

### Blocker 2: `/data/list/*` Returns 404

**11:30 - Investigation**

Error was: `{"error":"Unknown source: local"}`

The issue was testing the wrong path:
- Tested: `/api/v1/api/list/local/TVApp`
- Correct: `/api/v1/api/list/folder/TVApp`

The new backend uses `folder` as the source name (from FolderAdapter), not `local`.

**Verification:**
```bash
curl -s "http://localhost:3111/api/v1/api/list/folder/TVApp" | head -c 200
# Returns: {"source":"folder","path":"TVApp","items":[...]}
```

**Resolution:** Not a code fix needed - this is a path mapping issue for frontend migration:

| Legacy Path | New Path |
|-------------|----------|
| `/data/list/{key}` | `/api/v1/api/list/folder/{key}` |
| `/data/list/{key}/playable` | `/api/v1/api/list/folder/{key}/playable` |

---

### Blocker 3: `/data/scripture/*` Returns 404

**11:45 - Root Cause Found**

Error was: `{"error":"Scripture not found","path":"1-nephi-1"}`

The LocalContent router expected direct paths like `bom/sebom/31103` but frontend sends reference strings like `1-nephi-1`.

**Fix Applied** (`backend/src/4_api/routers/localContent.mjs`):

1. Added scripture reference lookup using `scripture-guide` library
2. Added helper functions:
   - `getVolumeFromVerseId()` - Maps verse_id to volume (ot/nt/bom/dc/pgp)
   - `getDefaultVersion()` - Gets first version directory for a volume
   - `resolveScripturePath()` - Resolves input to volume/version/verseId

3. Updated `createLocalContentRouter` to accept `dataPath` config
4. Updated `createApiRouters` in bootstrap.mjs to pass `dataPath`
5. Updated app.mjs to include `dataPath: dataBasePath` in router config

**Key code change:**
```javascript
// scripture-guide returns verse_ids array, get first one
const verseId = ref?.verse_ids?.[0];
if (verseId) {
  const volume = getVolumeFromVerseId(verseId);
  const version = getDefaultVersion(dataPath, volume);
  return { volume, version, verseId: String(verseId) };
}
```

**Verification:**
```bash
# Reference string format
curl -s "localhost:3111/api/v1/api/local-content/scripture/1-nephi-1" | jq '{reference, volume}'
# Returns: {"reference":"1 Nephi 1","volume":"bom"}

# Direct verse_id format
curl -s "localhost:3111/api/v1/api/local-content/scripture/31103" | jq '{reference, volume}'
# Returns: {"reference":"1 Nephi 1","volume":"bom"}

# Volume name format
curl -s "localhost:3111/api/v1/api/local-content/scripture/bom" | jq '{reference, volume}'
# Returns: {"reference":"1 Nephi 1","volume":"bom"}
```

---

### Blocker 4: `/api/fitness/zone_led` Returns Home Assistant Error

**12:00 - Root Cause Found**

Error was: `{"reason":"Missing baseUrl or token configuration"}`

Two issues:
1. `system-local.yml` had macOS paths (for laptop dev), not Linux paths for this server
2. Home Assistant token was in household auth file but not being loaded into fitness config

**Fix Applied:**

1. **Updated `system-local.yml`** with correct Linux paths and HA host:
```yaml
path:
  media: /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media
  data: /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data

home_assistant:
  # Use Docker network IP for local dev (HA container on kckern-net)
  host: http://172.18.0.22:8123
```

2. **Updated `backend/src/app.mjs`** to get HA token from ConfigService (like Plex):
```javascript
// Before:
const homeAssistantConfig = process.env.home_assistant || {};
// ...
token: homeAssistantConfig.token || ''

// After:
const homeAssistantConfigEnv = process.env.home_assistant || {};
const homeAssistantAuth = configService.getHouseholdAuth('homeassistant') || {};
// ...
token: homeAssistantAuth.token || homeAssistantConfigEnv.token || ''
```

This follows the same pattern used for Plex auth - host from system config, token from household auth file.

**Verification:**
```bash
curl -s "localhost:3111/api/v1/api/fitness/zone_led/status" | jq .
# Returns: {"enabled":true,"scenes":{...},"state":{...}}
```

---

## Summary

All 4 blockers resolved:

1. **`/media/log`** - Fixed path to use `${dataBasePath}/history/media_memory`
2. **`/data/list/*`** - Documented path mapping: use `/api/v1/api/list/folder/{key}`
3. **`/data/scripture/*`** - Added scripture reference lookup in LocalContent router
4. **`/api/fitness/zone_led`** - Fixed HA config loading from household auth + system-local.yml

### Files Modified

| File | Changes |
|------|---------|
| `backend/src/app.mjs` | Fixed watchStatePath, added HA auth from ConfigService |
| `backend/src/0_infrastructure/bootstrap.mjs` | Added dataPath param to createApiRouters |
| `backend/src/4_api/routers/localContent.mjs` | Added scripture reference lookup |
| `data/system/system-local.yml` | Updated paths and HA host for Linux dev |

