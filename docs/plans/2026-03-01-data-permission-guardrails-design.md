# Data Permission Guardrails Design

**Date:** 2026-03-01
**Status:** Approved

## Problem

The Docker container runs as `node` (uid=1000), but files in the mounted data volume can become root-owned via Dropbox sync or manual edits. This causes:
- Scheduler state (`cron-runtime.yml`) becomes unwritable → weather harvester loops every 5 seconds
- Nutribot food log (`nutrilog.yml`) becomes unwritable → all UPC scans fail
- Any data file can silently become inaccessible

The codebase has ~37 direct filesystem write calls across three pathways (DataService, FileIO, admin routers) and none enforce or validate ownership.

## Solution: Three Layers of Defense

### Layer 1: Entrypoint — Root Start + Chown + Privilege Drop

The Dockerfile currently sets `USER node` before ENTRYPOINT, so the entrypoint can't fix root-owned files.

**Dockerfile changes:**
- Add `su-exec` to `apk install` line
- Remove `USER node` directive (entrypoint handles privilege drop)

**Entrypoint changes:**
- Add ownership fix before app start:
  ```sh
  find /usr/src/app/data -not -user node -exec chown node:node {} +
  ```
- Drop privileges via `exec su-exec node forever index.js`
- `find -not -user node` is faster than blanket `chown -R` — only touches files that need fixing

### Layer 2: Boot Health Check — Validate Critical Paths

Lightweight Node.js check at app boot after config is loaded.

**What it checks:**
- Write-tests critical directories: `data/system/state/`, `data/household/`, `data/users/`
- Creates and deletes a `.write-test` temp file in each
- Logs structured warnings with exact path and suggested fix on failure

**What it does NOT do:**
- Does not block startup
- Does not recursively scan every file
- Does not attempt to fix permissions (no root at this point)

**Location:** `backend/src/0_system/boot/validateDataPermissions.mjs`

### Layer 3: FileIO Hardening — Actionable EACCES Errors

**DataService `writeYamlFile`:**
- Catch EACCES specifically, log structured error with path, file owner, running user
- Still returns `false` (callers already handle that)

**FileIO write functions (`saveYaml`, `writeFile`, `writeBinary`, `saveYamlToPath`):**
- Same EACCES detection and structured logging
- Continue to throw (existing behavior) but with actionable context

**What this does NOT do:**
- No retry logic or auto-fix attempts
- No new abstraction layer
- No changes to the 37 call sites

## Files Changed

| File | Change |
|------|--------|
| `docker/Dockerfile` | Add `su-exec`, remove `USER node` |
| `docker/entrypoint.sh` | Ownership fix + privilege drop |
| `backend/src/0_system/boot/validateDataPermissions.mjs` | New: startup health check |
| `backend/src/0_system/config/DataService.mjs` | EACCES logging in `writeYamlFile` |
| `backend/src/0_system/utils/FileIO.mjs` | EACCES logging in write functions |
| Bootstrap sequence | Call `validateDataPermissions` at boot |

## Not Changed

- No changes to the 37 call sites
- No new abstraction layers
- No behavioral changes to existing error handling
