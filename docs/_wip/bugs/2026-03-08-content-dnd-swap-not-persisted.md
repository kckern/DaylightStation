# Content DnD Swap Not Persisted + Blur Freeform Saves Invalid ID

**Date:** 2026-03-08
**App:** Admin (ListsFolder / ContentSearchCombobox)
**Status:** Partially resolved — see details below
**Severity:** High — silent data loss
**Affected file:** `data/household/config/lists/menus/fhe.yml`

---

## Bug 1: Content Swap Race Condition

### Status: Code fix deployed, but blocked by file permission issue on prod

### What was fixed (commit 3583b43f)

Added atomic `PUT /items/swap` backend endpoint (single read-mutate-write), `swapItems` hook function, `swapInProgressRef` lock in `handleDragEnd`, and optimistic `setSections` update. Eliminates both the backend write race and the frontend stale-state race.

### What still failed

After deploying the fix to the Docker container, the swap endpoint returned **HTTP 500** with:

```
EACCES: permission denied, open '/usr/src/app/data/household/config/lists/menus/fhe.yml'
```

### Root cause: file ownership mismatch

The Node process inside the Docker container runs as user `node`, but `fhe.yml` was owned by `root:root` with mode `644` (owner read-write only). All other YAML files in the same directory are `node:node` with mode `664`.

| File | Owner | Mode | Writable by `node`? |
|------|-------|------|---------------------|
| `fhe.yml` | `root:root` | `644` | No |
| `adhoc.yml` | `node:node` | `664` | Yes |
| `ambient.yml` | `node:node` | `664` | Yes |
| (all others) | `node:node` | `664` | Yes |

**How the ownership got corrupted:** The dev server (running as the local macOS user) wrote to `fhe.yml` via the Dropbox-mounted data path. This file synced into the Docker volume with `root:root` ownership, locking out the `node` user inside the container.

### Fix applied

```bash
docker exec daylight-station chown node:node /usr/src/app/data/household/config/lists/menus/fhe.yml
docker exec daylight-station chmod 664 /usr/src/app/data/household/config/lists/menus/fhe.yml
```

### Remaining risk

Any time the dev server writes to a list YAML file via the Dropbox mount, the same ownership corruption can recur. This is a systemic issue with the dev-server-writes-to-prod-data-via-Dropbox workflow. Possible mitigations:
- Add a `chown` step to `deploy.sh` that normalizes all data file ownership after deployment
- Have the backend `saveList` method set file permissions explicitly after write
- Avoid running the dev server against the Dropbox-synced data path

### Timeline of swap attempts

| Time (UTC) | Source | Event | Result |
|------------|--------|-------|--------|
| 22:02:06 | frontend (session 1) | `content.swap` idx 4↔2 | Backend succeeded (`admin.lists.items.swapped`) |
| 22:02:20 | frontend (session 2) | `content.swap` idx 4↔2 | Backend succeeded — reversed the first swap |
| 22:17:43 | frontend (session 3) | `content.swap` idx 2↔4 | **HTTP 500 — EACCES** |

The first two swaps succeeded (file was still writable at that point). The third failed after the file ownership was corrupted by an intervening dev server write.

### Evidence

**Docker log showing EACCES:**
```json
{"ts":"2026-03-08T15:17:43.374","level":"error","event":"admin.lists.items.swap.failed",
 "data":{"type":"menus","list":"fhe","a":{"section":0,"index":2},"b":{"section":0,"index":4},
 "error":"EACCES: permission denied, open '/usr/src/app/data/household/config/lists/menus/fhe.yml'"}}
```

**Frontend error:**
```json
{"event":"content.swap.failed",
 "data":{"error":"HTTP 500:  - {\"error\":\"Failed to swap items\"}"}}
```

**API endpoint direct test (after permission fix):**
```bash
curl -X PUT http://localhost:3111/api/v1/admin/content/lists/menus/fhe/items/swap \
  -H 'Content-Type: application/json' \
  -d '{"a":{"section":0,"index":4},"b":{"section":0,"index":2}}'
# → {"ok":true,"type":"menus","list":"fhe"}
```

### Current state of fhe.yml

The data has been modified by multiple swap attempts and needs manual correction. Known issues:
- Felix (index 2): `plex:642175` — may not be the intended content
- Alan (index 4): `plex:457404` — may not be the intended content
- Closing Hymn (index 8): still needs `input: singalong:primary/57` (see Bug 2)

---

## Bug 2: Blur Commits Raw Search Query as Content ID

### Status: Partially fixed (search routing fixed, blur-commit UX still open)

### Symptom

User was searching for a primary song ("Tell Me...") but the search took **17 seconds**. Before results loaded, the field lost focus (blur). The raw search text `primary:tell me` was saved as a freeform value — which is not a valid content ID — causing a 404.

### Timeline (from logs)

| Time | Event | Detail |
|------|-------|--------|
| 21:03:16.044 | `editing.start` | Editing `singalong:hymn/97` at index 8 |
| 21:03:56.471 | `search.request` | Typed `primary` |
| 21:04:00.424 | `search.request` | Typed `primary:tell me` |
| 21:04:17.252 | `search.results` | 20 results returned after **16,829ms** |
| 21:04:17.415 | `commit.freeform` | Blur trigger — saved `primary:tell me` (raw query, not a content ID) |
| 21:04:19.802 | `content_api.error_status` | 404 for `primary:tell me` — invalid ID |

### Root Cause: Slow Search Due to Missing Alias Resolution

The `primary:` prefix should route to only the `singalong` adapter, but instead searched ALL 12 adapters. Two separate alias systems existed and didn't talk to each other:

1. **`content-prefixes.yml` aliases** — used for direct ID lookup, NOT used for text search routing
2. **`ContentQueryAliasResolver`** — used for search routing, did NOT read `content-prefixes.yml`

### Resolution (Search Routing)

**Status: Fixed** (commit 11082a8e)

`ContentQueryAliasResolver` now accepts `prefixAliases` and checks them in the resolution chain. Results:
- `primary:tell me` → singalong only, **1.5s** (was 6-17s)
- `hymn:love` → singalong only, **259ms** (was 6s+)

### Still open: Blur-commit UX

The blur handler doesn't distinguish "search-in-progress" from intentional commit. With faster search this is less likely, but not eliminated. The Closing Hymn field needs manual correction:

```yaml
# Current (invalid):
- input: primary:tell me
  label: Closing Hymn

# Correct:
- input: singalong:primary/57
  label: Closing Hymn
```

### Where to Fix (blur-commit)

| File | What |
|------|------|
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Blur handler — suppress freeform commit if search is still pending |
