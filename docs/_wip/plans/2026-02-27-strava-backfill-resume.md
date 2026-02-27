# Strava Re-backfill — Resume Tomorrow

**Date:** 2026-02-27
**Status:** Paused — daily read rate limit exhausted

---

## What Was Done

### DDD Refactor
- Moved `buildStravaDescription.mjs` → `backend/src/1_adapters/fitness/`
- Moved + renamed `StravaEnrichmentService` → `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`
- Deleted `backend/src/3_applications/strava/` (vendor name doesn't belong at application layer)
- Updated `app.mjs` import accordingly

### buildStravaDescription Rewrite
New logic in `backend/src/1_adapters/fitness/buildStravaDescription.mjs`:
- **Primary episode:** longest `durationSeconds` (not first)
- **Watch filter:** episodes < 2 min suppressed (was showing cold-start warmups as primary)
- **Multi-episode:** ALL watched episodes in description with `🖥️ Show — Episode\nDescription`
- **`_getEpisodeWatchMs`:** two-pass — direct `end-start` if ≥ 2min, else consecutive timestamps (handles old `media_memory_crossref` sessions)
- **`_flattenText`:** collapses newlines in Plex descriptions

### Plex Description Backfill (Historical YAMLs)
- Script: `/tmp/backfill_plex_descriptions.py`
- Fetches `GET /api/v1/info/plex/{id}` → `metadata.summary`
- Patched 13 session YAML files with missing episode descriptions
- Also backfills `durationSeconds` if missing

### Persistence Layer Fix
- `PersistenceManager.js`: added `_enrichMissingPlexDescriptions(events)`
- Runs before every session save — fetches Plex descriptions for any media event with `plex:` contentId and no description
- No-op if Plex is down (per-event errors swallowed)

---

## Re-backfill Script

**Script:** `/tmp/strava_rebackfill.py`

Updated Python `build_description()` to match new JS logic:
- Primary by `durationSeconds`
- Watch-time filter (2 min) via `_get_episode_watch_ms()`
- All watched episodes in description

**No GET requests** — uses precomputed data only (1 API call per activity instead of 2).

### Progress So Far
- **Total eligible:** 355 activities
- **Successfully updated (run 1):** 17 activities (indices 0–27)
- **Remaining:** 320 activities (indices 35–354)

### Why Paused
First run used GET-per-activity, burning 1300+ daily read requests (limit: 1000/day).
Daily limit resets at **midnight Pacific**.

---

## Resume Command

```bash
/tmp/strava_venv/bin/python3 -u /tmp/strava_rebackfill.py --yes --offset=35
```

- `--offset=35` skips the first 35 already-handled entries
- No GETs — only PUTs (320 writes, well within 2000/day limit)
- 5s delay between writes → ~27 min runtime
- Auto-retries on 429 with 15-min wait

### Rate Limit Headroom Tomorrow
- Writes: 320 needed, 2000/day available ✓
- Reads: 0 needed (GET removed from script) ✓
