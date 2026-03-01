# Fitness Session Media Data Quality Audit

**Date:** 2026-02-28
**Scope:** All 2,557 fitness session YAML files
**Triggered by:** Session `20260227054558.yml` — primary video `durationSeconds: 2`, last music track `start == end`, zero `playback.ended` events in prod logs
**Revised:** 2026-02-28 — updated with actual prod data verification via SSH

---

## Executive Summary

Three independent bugs cause media data loss in fitness sessions. **Bug A** (stale duration) and **Bug B** (missing end timestamps) are regressions concentrated in Feb 2026. **Bug C** (legacy missing durationMs) affects ~450 older sessions from 2021–2022. All three are fixable in code; Bugs A and B are also backfillable from existing session data.

**Code fixes implemented:** Bug A (`normalizeDuration` two-pass threshold), Bug B (`_closeOpenMedia` at session end).

---

## Bug A: `normalizeDuration()` Returns Stale Placeholder Values

### Root Cause

`frontend/src/modules/Player/utils/mediaIdentity.js:36-44` — `normalizeDuration()` returned the **first non-null candidate**. When `media_start` fires, `media.duration` may hold a Plex metadata placeholder (e.g. `2` = season number) before the HTML5 player reports the real duration.

```javascript
// mediaIdentity.js:36-44 (BEFORE fix)
export const normalizeDuration = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const normalized = typeof candidate === 'string' ? parseFloat(candidate) : Number(candidate);
    if (!Number.isFinite(normalized) || normalized <= 0) continue;
    return normalized > 1000 ? Math.round(normalized / 1000) : Math.round(normalized);
  }
  return null;
};
```

### Call Sites

| File | Line | Candidates Passed |
|------|------|-------------------|
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | 1014–1018 | `media.duration`, `media.length`, `media.metadata?.duration` |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | 273–277 | `currentTrack?.duration`, `currentTrack?.length`, `currentTrack?.Duration` |

### Why `2`?

Plex metadata objects sometimes contain a short integer (e.g. `2`) as a placeholder or season number that gets picked up by `media.duration` before the actual video element reports its real duration (e.g. `1888.4266`). The `>1000 → divide by 1000` heuristic doesn't filter this because `2` is a valid small number.

### Git Blame

- `normalizeDuration` introduced: `635fdfc81` (2025-12-08)
- `media_start` logging with `normalizeDuration`: `7519510cc` (2025-12-02)

### Fix Applied

Two-pass approach in `normalizeDuration()`:
1. First pass: prefer candidates ≥ 10 seconds (real media durations)
2. Fallback: accept any positive value (for genuinely short media)

```javascript
// mediaIdentity.js:36-60 (AFTER fix)
const MIN_PLAUSIBLE_DURATION_SEC = 10;

export const normalizeDuration = (...candidates) => {
  const toSeconds = (v) => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1000 ? Math.round(n / 1000) : Math.round(n);
  };

  // First pass: prefer candidates ≥ 10s (skips Plex placeholders like "2")
  for (const candidate of candidates) {
    const sec = toSeconds(candidate);
    if (sec != null && sec >= MIN_PLAUSIBLE_DURATION_SEC) return sec;
  }

  // Fallback: accept any positive value (for genuinely short media)
  for (const candidate of candidates) {
    const sec = toSeconds(candidate);
    if (sec != null) return sec;
  }
  return null;
};
```

### Affected Sessions (verified from prod YAML)

| Session | ContentId | Title | Recorded `durationSeconds` | Summary `durationMs` | Type |
|---------|-----------|-------|---------------------------|----------------------|------|
| `20260224124137` | `plex:10551` | Sculpt A | **2** | **0** | Workout |
| `20260225053400` | `plex:600161` | Saturday Special | **2** | **0** | Workout |
| `20260227054558` | `plex:664558` | Total Body Tempo | **2** | **2003610** ✓ | Workout |
| `20260223185457` | `plex:606442` | Mario Kart 8 | **10** | **0** | Gaming |
| `20260224190930` | `plex:606442` | Mario Kart 8 | **10** | **0** | Gaming |
| `20260225181217` | `plex:606442` | Mario Kart 8 | **10** | **0** | Gaming |
| `20260225181217` | `plex:649319` | Mario Kart 8 Deluxe | **15** | **0** | Gaming |
| `20260226185825` | `plex:649319` | Mario Kart 8 Deluxe | **17** | **14** | Gaming |

**Key finding:** Session `20260227054558` has correct `durationMs: 2003610` in the summary block despite having `durationSeconds: 2` in the timeline event. This is because `durationMs` in the summary is computed from `end - start` when both timestamps exist. The two older workout sessions (`20260224124137`, `20260225053400`) have `durationMs: 0` because they also have Bug B (`end: null`).

---

## Bug B: Last Media Never Gets `media_end` Event

### Root Cause

`media_end` is only emitted via React `useEffect` cleanup — it fires when `currentMediaIdentity` **changes** (new track replaces old one). The **last** video or music track in a session never gets replaced, so its cleanup never fires.

```javascript
// FitnessPlayer.jsx:1053-1061
return () => {
  // Log media_end for the media that's being replaced
  if (currentMediaIdentity && session) {
    session.logEvent('media_end', {
      contentId: currentMediaIdentity,
      source: 'video_player',
    });
  }
};
// Dependencies: [fitnessSessionInstance, currentMediaIdentity, enhancedCurrentItem, ...]
```

```javascript
// FitnessMusicPlayer.jsx:292-300
return () => {
  if (currentTrackIdentity && sessionInstance) {
    sessionInstance.logEvent('media_end', {
      contentId: currentTrackIdentity,
      source: 'music_player',
    });
  }
};
// Dependencies: [sessionInstance, currentTrackIdentity, currentTrack, ...]
```

### Why `endSession()` Didn't Help

`FitnessSession.js:1703-1749` — `endSession()` collects a final tick and persists, but **never fired `media_end`** for the currently-playing media. It has no reference to what's currently playing.

### Impact on Consolidation

`PersistenceManager.js:446-466` — when `endEvt` is null, the consolidated event gets `end: null`:

```javascript
// PersistenceManager.js:466
end: Number(endEvt?.timestamp) || null,  // null when no media_end
```

### Git Blame

- `media_end` cleanup effects: `5c7d74284` and `dff07f05f` (2026-02-26)
- Event consolidation: `7f8b055e3` (2026-02-13)

### Prod Log Evidence

Session `20260227054558` prod log (`2026-02-27T13-45-33.jsonl`, 3.1MB, 6575+ lines):

```json
// media_start autoplay event — only log line with media_start in the session log
{"ts":"2026-02-27T13:46:00.054Z","level":"info","event":"fitness.media_start.autoplay",
 "data":{"contentId":"plex:664558","autoplay":true,"videoLocked":false,
         "isGoverned":false,"governancePhase":"idle","labels":["nomusic"]},
 "context":{"source":"frontend","app":"fitness","sessionLog":true}}
```

- `fitness.media_start.autoplay` events: 1 (video only — music tracks don't emit this)
- `playback.ended` events: **0** (none exist in the entire log)
- `media_end` events in timeline: only for music tracks 1–9 (via identity change); **track 10 and video have no end**

### Fix Applied

Added `_closeOpenMedia(now)` method to `FitnessSession.js:1752-1770`, called from `endSession()` at line 1724:

```javascript
// FitnessSession.js:1752-1770
_closeOpenMedia(now) {
  if (!this.timeline?.events) return;

  const opened = new Set();
  for (const evt of this.timeline.events) {
    const id = evt.data?.contentId;
    if (!id) continue;
    if (evt.type === 'media_start') opened.add(id);
    if (evt.type === 'media_end') opened.delete(id);
  }

  for (const contentId of opened) {
    this.logEvent('media_end', { contentId, source: 'session_end' }, now);
  }
}
```

### Affected Sessions (verified from prod YAML)

| Session | ContentId | Title | `start` | `end` | Issue |
|---------|-----------|-------|---------|-------|-------|
| `20260223185457` | `plex:606442` | Mario Kart 8 | `1771901831826` | **`null`** | No media_end |
| `20260224124137` | `plex:10551` | Sculpt A | `1771966240844` | **`null`** | No media_end |
| `20260224190930` | `plex:606442` | Mario Kart 8 | `1771989003716` | **`null`** | No media_end |
| `20260225053400` | `plex:600161` | Saturday Special | `1772026442559` | **`null`** | No media_end |
| `20260225181217` | `plex:606442` | Mario Kart 8 | `1772072095953` | **`null`** | No media_end |
| `20260225181217` | `plex:649319` | Mario Kart 8 Deluxe | `1772072133867` | **`null`** | No media_end |
| `20260226185825` | `plex:649319` | Mario Kart 8 Deluxe | `1772161407554` | `1772161407568` | start≈end (14ms gap) |
| `20260227054558` | `plex:140612` | Hit Me With Your Best Shot | `1772201827479` | `1772201827479` | start==end |

**Key finding:** Two sessions show `end ≈ start` rather than `null` — the `media_end` cleanup fired but with the same timestamp as `media_start`, suggesting the cleanup ran synchronously rather than being skipped entirely. The underlying cause is the same: the React cleanup fires at component unmount (session end), but by then the timestamp matches the start because no time has elapsed in the cleanup path.

---

## Bug C: Legacy Missing `durationMs` in Summary Block

### Root Cause

~450 sessions from 2021–2022 predate the current summary format. Their `summary.media[]` entries lack `durationMs` entirely. This is a schema evolution issue, not a runtime bug.

### Scope

- **450 sessions** affected, primarily Jan 2021 – Dec 2022
- No code fix needed — these are historical data holes
- Backfillable: `durationMs` can be computed from `session.duration_seconds` or Plex metadata

### Example

```yaml
# 20210105125506.yml
summary:
  media:
    - title: The Challenge
      showTitle: P90X3
      primary: true
      contentId: plex:600166
      # durationMs: MISSING
```

---

## Issue D: Sessions With No Media (NO_MEDIA) — Verified

| Session | Date | Duration | Participants | Coins | Finding |
|---------|------|----------|-------------|-------|---------|
| `20260228191219` | 2026-02-28 | 2.2m | 3 (Felix, Alan, Milo) | 13 | **Legitimate** — YAML has empty `events: []` and `media: []`. Short family session, no video loaded. |
| `20260204054123` | 2026-02-04 | 13.4m | 1 | 32 | Needs investigation |
| `20260130190430` | 2026-01-30 | 12.7m | 1 | 176 | Needs investigation |
| `20260128051015` | 2026-01-28 | 16.3m | 1 | 137 | Needs investigation |

Session `20260228191219` is confirmed NOT a bug — it's a real session where HR was tracked but no media was played (2min 15sec, 3 kids with HR monitors, some coins earned from heart rate zones). Verified from prod YAML at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/history/fitness/2026-02-28/20260228191219.yml`.

---

## Issue E: Sessions With Zero Coins (`ZERO_COINS`)

7 sessions return `totalCoins: 0`:

| Session | Date | Duration | Participants | Media |
|---------|------|----------|-------------|-------|
| `20260213062410` | 2026-02-13 | 22.7m | 1 | Squishmallow Workout Dance Party |
| `20260209131633` | 2026-02-09 | 4.7m | 1 | Week 1 Day 1: Lower Body |
| `20260209131631` | 2026-02-09 | 48.6m | 5 | Week 1 Day 1: Lower Body |
| `20260204085404` | 2026-02-04 | 34.0m | 5 | Mario Kart Wii |
| `20260203061904` | 2026-02-03 | 31.5m | 1 | Upper Body Stretches |
| `20260202053008` | 2026-02-02 | 37.5m | 1 | Kettlebell Swings: Foundations |
| `20260130052050` | 2026-01-30 | 24.0m | 1 | Burn |

---

## Issue F: Duplicate/Ghost Sessions

Multiple session pairs share the same media and near-identical timestamps — one has coins, the other has zero. These appear to be ghost sessions from the multi-client architecture (Shield TV + Mac both running):

| Real Session | Ghost Session | Media | Real Coins | Ghost Coins |
|-------------|---------------|-------|------------|-------------|
| `20260211051029` (14.1m) | `20260211051026` (36.8m) | Ten minute warm-up | 173 | 482 |
| `20260210123112` (14.1m) | `20260210123109` (32.2m) | Cardio Foundations | 159 | 1985 |
| `20260209131633` (4.7m) | `20260209131631` (48.6m) | Week 1 Day 1 | 0 | 0 |
| `20260203061904` (31.5m) | `20260203060124` (17.0m) | Upper Body Stretches | 0 | 37 |
| `20260202053011` (17.0m) | `20260202053008` (37.5m) | Kettlebell Swings | 172 | 0 |
| `20260130052055` (9.5m) | `20260130052050` (24.0m) | Burn | 208 | 0 |

Note: which one is the "real" session vs the "ghost" is ambiguous — sometimes the shorter one has coins, sometimes the longer one does.

---

## Cross-Bug Overlap (verified)

5 sessions are affected by **both** Bug A and Bug B:

| Session | Bug A value | Bug B value | Summary `durationMs` |
|---------|------------|-------------|---------------------|
| `20260224124137` | durationSeconds: 2 | end: null | 0 |
| `20260224190930` | durationSeconds: 10 | end: null | 0 |
| `20260225053400` | durationSeconds: 2 | end: null | 0 |
| `20260225181217` | durationSeconds: 10, 15 | end: null | 0 |
| `20260226185825` | durationSeconds: 17 | end ≈ start | 14 |
| `20260227054558` | durationSeconds: 2 | start == end (last track) | 2003610 ✓ (video has proper end) |

**Pattern:** When both bugs overlap, `durationMs` in the summary is always `0` or near-zero because it's computed from `end - start`, and `end` is null or equal to start.

---

## Healthy Baseline: `media_memory_crossref` Sessions

27 sessions have `source: media_memory_crossref` — these bypass the frontend media pipeline entirely and get correct durations from Plex metadata. Example:

```yaml
# 20260226054502.yml — durationSeconds: 1029 ✓, end: 1772113878000 ✓
source: media_memory_crossref
contentId: plex:662665
durationSeconds: 1029
start: 1772113502970
end: 1772113878000
```

This confirms the data model is correct; the bugs are in the frontend event logging path.

---

## Data Scope Summary

| Category | Count | Date Range |
|----------|-------|------------|
| Total sessions | 2,557 | 2021–2026 |
| Bug A: stale duration (workout videos) | 3 confirmed | Feb 24–27, 2026 |
| Bug A: low duration (gaming, may be real) | 8 events / 5 sessions | Feb 13–26, 2026 |
| Bug B: missing end timestamp | 7 sessions | Feb 23–27, 2026 |
| Bug C: legacy missing durationMs | ~450 sessions | 2021–2022 |
| Clean sessions | ~2,184 | All dates |
| `media_memory_crossref` (always correct) | 27 sessions | Oct 2025–Feb 2026 |

---

## Code Path Diagram

```
Video plays on Shield TV
  → useEffect fires (FitnessPlayer.jsx:998)
    → normalizeDuration(media.duration, ...)     ← BUG A: may get placeholder
    → session.logEvent('media_start', { durationSeconds, ... })
      → FitnessSession.logEvent() → FitnessTimeline.events.push()

  → useEffect cleanup (FitnessPlayer.jsx:1053)   ← BUG B: only fires on identity CHANGE
    → session.logEvent('media_end', { contentId })
      → FitnessTimeline.events.push()

Session ends
  → endSession() (FitnessSession.js:1703)
    → _collectTimelineTick()
    → _closeOpenMedia(now)                        ← NEW FIX: closes unpaired media_start
    → summary → _persistSession()
      → _consolidateEvents() (PersistenceManager.js:291)
        → mediaMap pairs media_start + media_end by contentId
        → end: Number(endEvt?.timestamp) || null  ← null if no media_end
    → reset()
```

---

## Prod Environment Notes

- **Data path:** `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/history/fitness/`
- **Docker mount:** `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data` → `/usr/src/app/data`
- **Dropbox status at audit time:** NOT RUNNING (daemon reinstalled during audit, needs re-linking)
- **Prod logs:** `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/`
- **Session `20260227054558` log:** `2026-02-27T13-45-33.jsonl` (3.1MB, 6575+ lines)

---

## Code Changes Made

### `frontend/src/modules/Player/utils/mediaIdentity.js`

`normalizeDuration()` — two-pass approach with 10-second minimum threshold:
- Pass 1: prefer candidates ≥ 10 seconds (skips Plex placeholders like `2`)
- Pass 2: fallback to any positive value (for genuinely short media)

### `frontend/src/hooks/fitness/FitnessSession.js`

Added `_closeOpenMedia(now)` method:
- Scans `timeline.events` for `media_start` without matching `media_end`
- Emits `media_end` with `source: 'session_end'` for each open media
- Called from `endSession()` at line 1724, before building summary and persisting

---

## Related Prior Work

| Doc | Relevance |
|-----|-----------|
| `_wip/plans/2026-02-26-fitness-data-quality-fixes.md` | Groups A/B/C — zone display, media identity namespacing, HR quality |
| `_wip/plans/2026-02-26-fitness-session-media-visibility-fix.md` | Bug 1 (missing summary) and Bug 2 (media events lost) — overlaps with Bug B here |
| `_wip/audits/2026-02-26-fitness-session-media-visibility-audit.md` | 41/49 sessions invisible on dashboard |
| `_wip/audits/2026-02-23-fitness-session-silent-failures-audit.md` | Voice memo data loss, watchTime always zero |
| `_wip/plans/2026-02-27-strava-backfill-resume.md` | Strava description re-backfill (paused at offset 35, 320 remaining) |
| `_wip/plans/2026-02-28-media-data-backfill-plan.md` | Backfill plan for Bugs A, B, C — data correction script |

---

## Recommended Next Steps

1. ~~Code fixes (Bugs A & B)~~ — **Done**
2. **Deploy** — push code to prod, restart container
3. **Backfill script** — see `docs/_wip/plans/2026-02-28-media-data-backfill-plan.md`
4. **Verify** — run a test fitness session to confirm new sessions get correct durations and end timestamps
5. **Bug C triage** — decide whether legacy 2021–2022 `durationMs` backfill is worth the effort
6. **Issues D/E/F** — investigate remaining NO_MEDIA, ZERO_COINS, and ghost/duplicate sessions (separate scope)
