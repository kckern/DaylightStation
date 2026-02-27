# Fitness Session Media Visibility Audit

**Date:** 2026-02-26
**Scope:** Session media persistence, summary generation, and dashboard display pipeline
**Severity:** High — majority of recent sessions invisible on dashboard

---

## Executive Summary

41 of 49 sessions since Jan 27 are **invisible** on the fitness dashboard. The dashboard filters to sessions with `media.primary` in the API response, but the API reads from a `summary.media` block that is missing from most recent session files. Two independent bugs compound: (1) summary blocks stopped being written for sessions after ~Feb 15, and (2) media events are being lost entirely from `timeline.events` in the newest sessions.

---

## Architecture: How Media Flows From Session to Dashboard

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐     ┌──────────────┐
│ Live Session     │     │ Session YAML File     │     │ Backend API     │     │ Frontend     │
│                  │     │                       │     │                 │     │              │
│ MediaPlayer      │──►  │ timeline.events[]     │     │                 │     │              │
│ fires media evt  │     │   type: media         │     │                 │     │              │
│                  │     │   data: {mediaId,..}  │     │                 │     │              │
│ PersistenceMgr   │──►  │                       │     │                 │     │              │
│ buildSession     │     │ summary:              │──►  │ findByDate()    │──►  │ fetchRecent  │
│ Summary()        │     │   media:              │     │ reads summary   │     │ Sessions()   │
│                  │     │     - mediaId: X       │     │ .media[]        │     │ filters on   │
│                  │     │       primary: true    │     │ builds primary/ │     │ media.primary│
│                  │     │                       │     │ others          │     │              │
└─────────────────┘     └──────────────────────┘     └─────────────────┘     └──────────────┘
```

### Key Files

| Layer | File | Role |
|-------|------|------|
| Frontend save | `frontend/src/hooks/fitness/PersistenceManager.js:870-878` | Calls `buildSessionSummary()` to create `summary` block before API call |
| Summary builder | `frontend/src/hooks/fitness/buildSessionSummary.js:64-89` | Extracts media from `timeline.events`, marks longest as `primary: true` |
| Backend read | `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:249-266` | Reads `summary.media[]` to build API response — does NOT read `timeline.events` |
| Frontend filter | `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js:134` | `if (!s.media?.primary) continue;` — skips sessions without primary media |
| Backfill script | `cli/scripts/backfill-session-summaries.mjs` | Offline tool to retroactively build summary blocks from timeline events |

---

## Bug 1: Missing Summary Blocks

### Observation

Sessions saved after ~Feb 15 intermittently lack `summary:` blocks in their YAML files.

| Date Range | Sessions | With Summary | Without Summary |
|------------|----------|-------------|-----------------|
| Feb 2-14 | 17 | 17 (100%) | 0 |
| Feb 15 | 5 | 0 (0%) | 5 |
| Feb 16-20 | 5 | 5 (100%) | 0 |
| Feb 21-26 | 14 | 3 (21%) | 11 |

The Feb 16-20 sessions with summaries were likely created by the backfill script (commit `a1494394` on Feb 15 added the backfill tool). Sessions after Feb 20 that have summaries appear to be backfill artifacts. Live session saves stopped generating summaries.

### Root Cause Hypothesis

`PersistenceManager.persistSession()` (line 870) builds the summary from `persistSessionData.timeline.series` and `persistSessionData.timeline.events`. If either is empty/malformed at build time, the summary may be empty or absent. The backend `save_session` endpoint may also be stripping or ignoring the summary block.

### Impact

- 11 sessions with `timeline.events` containing media data but no `summary` block
- Backend API returns `media: null` for these sessions
- Dashboard silently hides them

---

## Bug 2: Media Events Lost From Timeline

### Observation

Several sessions have `events: []` (completely empty) despite Plex media playing during the session.

| Session | Date | Duration | Coins | Events |
|---------|------|----------|-------|--------|
| 20260226054502 | Feb 26 | 13m | 38 | `events: []` |
| 20260226055647 | Feb 26 | 3m | 0 | `events: []` |
| 20260219063545 | Feb 19 | 35m | 21 | `events: []` (but summary has 4 media from backfill) |
| 20260221154843 | Feb 21 | 49m | 351 | `events: []` (but summary has 1 media from backfill) |
| 20260223135838 | Feb 23 | 37m | 156 | `events: []` (but summary has 2 media from backfill) |

The Feb 26 sessions are **catastrophic**: no events AND no summary. Media data is completely gone — unrecoverable from the session file alone.

### Contrast With Working Sessions

Working session `20260220054304` (Cardio Power and Resistance) has:
- `timeline.events[0].type: media` with full metadata
- `timeline.events[0].data.source: backfill_enrich` — this was **backfill-enriched**, not recorded live

This suggests that even "working" sessions may have had their events populated by backfill, not live recording.

### Root Cause Hypothesis

Media events are generated when Plex playback is detected during a session. The pipeline that captures Plex `media.play` webhooks and injects them into `timeline.events` may be broken or disconnected. The `TimelineRecorder.js` does not appear to handle media events — it manages series data (HR, zones, coins). Media events may come from a separate path (e.g., Plex webhook → session event injection) that has regressed.

---

## Bug 3: Frontend Overly Strict Filter

### Code

```javascript
// useDashboardData.js:134
if (!s.media?.primary) continue;
```

### Problem

This filter silently drops sessions that have:
- `media.others` but no `media.primary` (11 sessions)
- No media at all (30 sessions)
- Media events in `timeline.events` but no `summary` block

### Impact

Real workout sessions with significant coins, duration, and HR data are invisible. Examples:

| Session | Date | Duration | Coins | Why Hidden |
|---------|------|----------|-------|------------|
| 20260225181217 | Feb 25 | 29m | 2255 | No summary (has media events) |
| 20260224190930 | Feb 24 | 26m | 1670 | No summary (has media events) |
| 20260223185457 | Feb 23 | 22m | 1704 | No summary (has media events) |
| 20260221154843 | Feb 21 | 49m | 351 | Summary has others only, no primary |
| 20260212183157 | Feb 12 | 28m | 2171 | Summary has others only, no primary |
| 20260210123109 | Feb 10 | 32m | 1985 | Summary has others only, no primary |

---

## Data Audit: All 49 Sessions Since Jan 27

### Legend
- **S** = has `summary:` block
- **E** = has media events in `timeline.events`
- **P** = has `summary.media[].primary: true`
- **V** = visible on dashboard

| Session ID | Date | Participants | Coins | Dur | S | E | P | V |
|------------|------|-------------|-------|-----|---|---|---|---|
| 20260127063319 | Jan 27 | kckern | 198 | 14m | ? | ? | ? | ? |
| 20260128051015 | Jan 28 | kckern | 137 | 16m | ? | ? | ? | ? |
| 20260129063324 | Jan 29 | kckern | 226 | 14m | ? | ? | ? | ? |
| 20260130052050 | Jan 30 | kckern | 0 | 24m | ? | ? | ? | ? |
| 20260130052055 | Jan 30 | kckern | 208 | 10m | ? | ? | ? | ? |
| 20260130190430 | Jan 30 | kckern | 176 | 13m | ? | ? | ? | ? |
| 20260131182219 | Jan 31 | kckern | 44 | 4m | ? | ? | ? | ? |
| 20260202053008 | Feb 2 | kckern | 0 | 38m | Y | Y | Y | Y |
| 20260202053011 | Feb 2 | kckern | 0 | -- | Y | - | - | N |
| 20260203061904 | Feb 3 | kckern | 0 | 32m | Y | Y | Y | Y |
| 20260204054123 | Feb 4 | kckern | 32 | 13m | Y | - | - | N |
| 20260204085404 | Feb 4 | 5 kids | 0 | 34m | Y | Y | Y | Y |
| 20260209134821 | Feb 9 | kckern | 92 | 5m | Y | Y | Y | Y |
| 20260210123109 | Feb 10 | alan+kckern | 1985 | 32m | Y | Y | - | N |
| 20260210123112 | Feb 10 | kckern | 159 | 14m | Y | Y | - | N |
| 20260211051026 | Feb 11 | kckern | 482 | 37m | Y | Y | Y | Y |
| 20260211051029 | Feb 11 | kckern | 173 | 14m | Y | Y | Y | Y |
| 20260212062500 | Feb 12 | kckern | 221 | 24m | Y | - | - | N |
| 20260212183157 | Feb 12 | alan | 2171 | 28m | Y | Y | - | N |
| 20260213062410 | Feb 13 | kckern | 0 | 23m | Y | Y | Y | Y |
| 20260213185600 | Feb 13 | alan+milo | 2102 | 30m | Y | Y | Y | Y |
| 20260214175142 | Feb 14 | kckern | 37 | 11m | Y | Y | Y | Y |
| 20260214192257 | Feb 14 | eli | 1316 | 21m | Y | - | - | N |
| 20260214192303 | Feb 14 | kckern | 80 | 8m | Y | - | - | N |
| 20260215190302 | Feb 15 | milo | 15 | 2m | - | Y | - | N |
| 20260215190551 | Feb 15 | 4 people | 13 | 1m | - | Y | - | N |
| 20260215190716 | Feb 15 | 5 people | 24 | 1m | - | Y | - | N |
| 20260215190819 | Feb 15 | 5 people | 36 | 1m | - | Y | - | N |
| 20260215191250 | Feb 15 | kckern | 0 | 8m | - | - | - | N |
| 20260216090933 | Feb 16 | kckern | 298 | 14m | Y | Y | - | N |
| 20260217124549 | Feb 17 | kckern | 171 | 15m | Y | Y | - | N |
| 20260218052928 | Feb 18 | kckern | 132 | 23m | Y | Y | Y | Y |
| 20260219063545 | Feb 19 | kckern | 21 | 35m | Y | - | - | N |
| 20260220054304 | Feb 20 | kckern | 266 | 41m | Y | Y | Y | Y |
| 20260221154843 | Feb 21 | kckern | 351 | 49m | Y | - | - | N |
| 20260223135838 | Feb 23 | kckern | 156 | 37m | Y | - | - | N |
| 20260223185457 | Feb 23 | kckern | 1704 | 22m | - | Y | - | N |
| 20260224124137 | Feb 24 | kckern | 431 | 37m | - | Y | - | N |
| 20260224190930 | Feb 24 | 4 kids | 1670 | 26m | - | Y | - | N |
| 20260225053400 | Feb 25 | kckern | 378 | 45m | - | Y | - | N |
| 20260225181217 | Feb 25 | 4 people | 2255 | 29m | - | Y | - | N |
| 20260225200645 | Feb 25 | 5 people | 11 | 1m | - | - | - | N |
| 20260225201016 | Feb 25 | 5 people | 12 | 1m | - | - | - | N |
| 20260225201935 | Feb 25 | 5 people | 12 | 1m | - | - | - | N |
| 20260225202140 | Feb 25 | 5 people | 11 | 1m | - | - | - | N |
| 20260225202340 | Feb 25 | 5 people | 10 | 1m | - | - | - | N |
| 20260225202603 | Feb 25 | 5 people | 38 | 2m | - | - | - | N |
| 20260225215637 | Feb 25 | alan+soren | 0 | 2m | - | Y | - | N |
| 20260226054502 | Feb 26 | kckern | 38 | 13m | - | - | - | N |
| 20260226055647 | Feb 26 | kckern | 0 | 3m | - | - | - | N |

---

## Recovery Plan

### Immediate: Backfill Missing Summaries

Run the existing backfill script for sessions that have `timeline.events` with media but no summary:

```bash
node cli/scripts/backfill-session-summaries.mjs --write
```

This will recover ~11 sessions that have events but no summary. It will NOT help sessions with `events: []`.

### Investigate: Media Event Loss

The Feb 26 sessions have `events: []` — media events are not being recorded. Need to trace:

1. How does the media player inject events into the session timeline?
2. Is the Plex webhook still firing during sessions?
3. Is `TimelineRecorder` or `FitnessTimeline` responsible for capturing media events, or is it a separate path?

### Investigate: Backfill From media_memory

`data/household/history/media_memory/plex/14_fitness.yml` contains Plex watch history for the fitness library. Cross-referencing session timestamps with `lastPlayed` timestamps could recover media associations for sessions with empty events.

### Fix: Frontend Filter

The `!s.media?.primary` filter should be relaxed. Options:
1. Show sessions with `media.others` (pick first as display title)
2. Show sessions without any media (use participant names or "Workout" as fallback title)
3. Show all sessions above a duration/coin threshold regardless of media

---

## Format Standardization Questions

The session YAML uses `mediaId` (Plex ratingKey) while the content system uses `contentId` (format: `source:localId`, e.g., `plex:602156`). The `summary.media` block uses raw `mediaId` without a source prefix. This creates a coupling to Plex that will break if other content sources are added. See `docs/reference/content/` for the content ID resolver pattern.

### Current State
- `timeline.events[].data.mediaId` → raw Plex ratingKey (e.g., `'602156'`)
- `summary.media[].mediaId` → same raw Plex ratingKey
- `useDashboardData.js` constructs thumbnail URL as `/api/v1/display/plex/${mediaId}` — hardcoded `plex` source
- Content system expects `plex:602156` format

### Recommendation
Defer format migration until the event loss bug is fixed. It's a separate concern.
